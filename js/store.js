// ─────────────────────────────────────────────────────────────
//  Store — one synchronous cache, two backends behind it.
//
//  Every screen reads/writes through this module and never knows which
//  backend is live. Getters read an in-memory cache (sync). Mutations
//  update the cache immediately (optimistic) and persist async:
//   • local    → whole blob to localStorage
//   • supabase → per-row writes; realtime keeps the cache fresh
//  Only boot + auth are async (see initSession / the *Async fns).
// ─────────────────────────────────────────────────────────────

import { config } from "./config.js";
import { migrateStop } from "./events.js";

const LOCAL_KEY = "gathering:v1";
const isSupa = () => config.BACKEND === "supabase";

let cache = { gathering: null, me: null, trips: {} };
let userId = null;
let unsub = null;
let dataCb = () => {};

let _sb = null;
async function sb() { if (!_sb) _sb = await import("./backend-supabase.js"); return _sb; }

export const uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12));
const now = () => new Date().toISOString();

// ── Normalize any trip to the current shape ──────────────────
function normalize(t) {
  return {
    ...t,
    startDate: t.startDate || null,
    departureTime: t.departureTime || "08:00",
    dayStart: t.dayStart || "09:00",
    legs: Array.isArray(t.legs) ? t.legs : [],
    jar: t.jar || { goal: 0, contributions: [] },
    checklist: Array.isArray(t.checklist) ? t.checklist : [],
    stops: (t.stops || []).map(migrateStop),
  };
}

// ── Boot ─────────────────────────────────────────────────────
// Returns { authed, gathering }. In local mode always authed.
export async function initSession() {
  if (!isSupa()) { loadLocal(); return { authed: true, gathering: cache.gathering }; }

  const api = await sb();
  const user = await api.getUser();
  if (!user) return { authed: false, gathering: null };
  userId = user.id;

  const m = await api.getMembership();
  if (!m) return { authed: true, gathering: null };
  setGathering(m);
  await hydrate();
  startRealtime();
  return { authed: true, gathering: cache.gathering };
}

function setGathering(m) {
  cache.gathering = { id: m.gatheringId, name: m.name, joinCode: m.joinCode, members: [] };
  cache.me = m.displayName;
}
async function hydrate() {
  const api = await sb();
  const trips = await api.loadTrips(cache.gathering.id);
  cache.trips = {};
  for (const t of trips) cache.trips[t.id] = normalize(t);
}
function startRealtime() {
  if (unsub) unsub();
  sb().then((api) => {
    unsub = api.subscribe(cache.gathering.id, async () => { await hydrate(); dataCb(); });
  });
}

// ── Auth passthrough (supabase mode) ─────────────────────────
export async function signUp(email, pw, name) { return (await sb()).signUp(email, pw, name); }
export async function signIn(email, pw) { return (await sb()).signIn(email, pw); }
export async function signOut() {
  if (isSupa()) { if (unsub) unsub(); await (await sb()).signOut(); }
  cache = { gathering: null, me: null, trips: {} };
}

export async function createGatheringAsync(name, display) {
  const m = await (await sb()).createGathering(name, display);
  setGathering(m); cache.trips = {}; startRealtime();
  return cache.gathering;
}
export async function joinGatheringCodeAsync(code, display) {
  const m = await (await sb()).joinByCode(code, display);
  setGathering(m); await hydrate(); startRealtime();
  return cache.gathering;
}

// ── Session / membership ─────────────────────────────────────
export function getSession() { return { gathering: cache.gathering, me: cache.me }; }

// Local-mode onboarding (unchanged behaviour)
export function joinGathering(gatheringName, memberName) {
  cache.gathering = cache.gathering || { id: uid(), name: gatheringName, members: [] };
  if (gatheringName) cache.gathering.name = gatheringName;
  cache.gathering.members = cache.gathering.members || [];
  if (!cache.gathering.members.includes(memberName)) cache.gathering.members.push(memberName);
  cache.me = memberName;
  persistLocal();
  return cache.gathering;
}

// ── Trips (sync reads from cache) ────────────────────────────
export function listTrips() {
  return Object.values(cache.trips).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
export function getTrip(id) { return cache.trips[id] || null; }

export function saveTrip(trip) {
  const t = normalize({ ...trip });
  t.id = t.id || uid();
  t.createdBy = t.createdBy || cache.me || "Someone";
  t.createdAt = t.createdAt || now();
  t.updatedAt = now();
  cache.trips[t.id] = t;
  if (isSupa()) sb().then((api) => api.upsertTrip(t, cache.gathering.id, userId)).catch(reportErr);
  else persistLocal();
  return t;
}
export function deleteTrip(id) {
  delete cache.trips[id];
  if (isSupa()) sb().then((api) => api.removeTrip(id)).catch(reportErr);
  else persistLocal();
}
export function duplicateTrip(id) {
  const orig = getTrip(id);
  if (!orig) return null;
  const copy = structuredClone(orig);
  copy.id = uid();
  copy.name = `${orig.name || "Trip"} (copy)`;
  copy.jar = { goal: orig.jar?.goal || 0, contributions: [] };
  copy.createdAt = now();
  copy.createdBy = cache.me || "Someone";
  return saveTrip(copy);
}

// ── Jar ──────────────────────────────────────────────────────
export function setGoal(tripId, goal) {
  const t = cache.trips[tripId]; if (!t) return;
  t.jar = t.jar || { goal: 0, contributions: [] };
  t.jar.goal = Number(goal) || 0;
  if (isSupa()) sb().then((api) => api.updateGoal(tripId, t.jar.goal)).catch(reportErr);
  else persistLocal();
  return t;
}
export function deposit(tripId, member, amount) {
  const t = cache.trips[tripId]; if (!t) return;
  t.jar = t.jar || { goal: 0, contributions: [] };
  const amt = Number(amount) || 0;
  t.jar.contributions.push({ id: uid(), member, amount: amt, at: now() });
  if (isSupa()) sb().then((api) => api.insertContribution(tripId, member, amt)).catch(reportErr);
  else persistLocal();
  return t;
}
export function jarTotals(trip) {
  const c = trip?.jar?.contributions || [];
  const saved = c.reduce((s, x) => s + x.amount, 0);
  const goal = trip?.jar?.goal || 0;
  const byMember = {};
  c.forEach((x) => (byMember[x.member] = (byMember[x.member] || 0) + x.amount));
  return { saved, goal, remaining: Math.max(goal - saved, 0), byMember };
}

// ── Stop social: reactions + comments ────────────────────────
export function reactToStop(tripId, stopId, emoji, me) {
  const t = getTrip(tripId); if (!t) return;
  const s = t.stops.find((x) => x.id === stopId); if (!s) return;
  s.reactions = s.reactions || {};
  const arr = s.reactions[emoji] || [];
  s.reactions[emoji] = arr.includes(me) ? arr.filter((m) => m !== me) : [...arr, me];
  if (!s.reactions[emoji].length) delete s.reactions[emoji];
  return saveTrip(t);
}
export function commentOnStop(tripId, stopId, by, text) {
  const t = getTrip(tripId); if (!t) return;
  const s = t.stops.find((x) => x.id === stopId); if (!s) return;
  s.comments = s.comments || [];
  s.comments.push({ id: uid(), by, text, at: now() });
  return saveTrip(t);
}

// ── Trip checklist ───────────────────────────────────────────
export function addChecklistItem(tripId, text, by) {
  const t = getTrip(tripId); if (!t) return;
  t.checklist = t.checklist || [];
  t.checklist.push({ id: uid(), text, done: false, by, at: now() });
  return saveTrip(t);
}
export function toggleChecklistItem(tripId, itemId) {
  const t = getTrip(tripId); if (!t) return;
  const it = (t.checklist || []).find((x) => x.id === itemId);
  if (it) it.done = !it.done;
  return saveTrip(t);
}
export function removeChecklistItem(tripId, itemId) {
  const t = getTrip(tripId); if (!t) return;
  t.checklist = (t.checklist || []).filter((x) => x.id !== itemId);
  return saveTrip(t);
}

// ── Change subscription (realtime or cross-tab) ──────────────
export function onTripsChanged(cb) { dataCb = cb; }
export function onData(cb) { dataCb = cb; }

// ── Local persistence ────────────────────────────────────────
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (s) { cache = { gathering: s.gathering, me: s.me, trips: {} };
      for (const [id, t] of Object.entries(s.trips || {})) cache.trips[id] = normalize(t); }
  } catch { /* fresh */ }
  window.addEventListener("storage", (e) => { if (e.key === LOCAL_KEY) { loadLocal(); dataCb(); } });
}
function persistLocal() {
  const blob = { gathering: cache.gathering, me: cache.me, trips: cache.trips };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(blob));
}

function reportErr(err) { console.error("Gathering sync error:", err?.message || err); }
