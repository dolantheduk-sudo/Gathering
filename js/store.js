// ─────────────────────────────────────────────────────────────
//  Store — the data layer.
//
//  Every screen talks to the app through THIS interface, never directly
//  to localStorage or Supabase. That is the second seam: to go multiplayer,
//  reimplement these functions against Supabase (stubs shown at the bottom)
//  and flip config.BACKEND — no screen code changes.
//
//  Shape of a trip:
//  {
//    id, name, type: "line" | "loop",
//    origin:      { label, lat, lng, placeId, photoUrl } | null,
//    destination: { ... } | null,   // for a loop this is the TURNAROUND (apex)
//    stops: [ { id, label, lat, lng, placeId, photoUrl, notes } ],
//    route: { distanceMeters, durationSeconds } | null,
//    jar:   { goal, contributions: [ { id, member, amount, at } ] },
//    createdBy, createdAt, updatedAt
//  }
// ─────────────────────────────────────────────────────────────

import { config } from "./config.js";

const KEY = "gathering:v1";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || seed(); }
  catch { return seed(); }
}
function write(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}
function seed() {
  return write({ gathering: null, me: null, trips: {} });
}

export const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

// ── Gathering / membership ───────────────────────────────────
export function getSession() {
  const s = read();
  return { gathering: s.gathering, me: s.me };
}
export function joinGathering(gatheringName, memberName) {
  const s = read();
  s.gathering = s.gathering || { id: uid(), name: gatheringName, members: [] };
  if (gatheringName) s.gathering.name = gatheringName;
  if (!s.gathering.members.includes(memberName)) s.gathering.members.push(memberName);
  s.me = memberName;
  return write(s).gathering;
}

// ── Trips ────────────────────────────────────────────────────
export function listTrips() {
  return Object.values(read().trips).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
export function getTrip(id) {
  return read().trips[id] || null;
}
export function saveTrip(trip) {
  const s = read();
  const t = { ...trip };
  t.id = t.id || uid();
  t.createdBy = t.createdBy || s.me || "Someone";
  t.createdAt = t.createdAt || now();
  t.updatedAt = now();
  t.jar = t.jar || { goal: 0, contributions: [] };
  s.trips[t.id] = t;
  write(s);
  return t;
}
export function deleteTrip(id) {
  const s = read();
  delete s.trips[id];
  write(s);
}

// ── Jar ──────────────────────────────────────────────────────
export function setGoal(tripId, goal) {
  const t = getTrip(tripId); if (!t) return;
  t.jar = t.jar || { goal: 0, contributions: [] };
  t.jar.goal = Number(goal) || 0;
  saveTrip(t);
  return t;
}
export function deposit(tripId, member, amount) {
  const t = getTrip(tripId); if (!t) return;
  t.jar = t.jar || { goal: 0, contributions: [] };
  t.jar.contributions.push({ id: uid(), member, amount: Number(amount) || 0, at: now() });
  saveTrip(t);
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

// ── Realtime hook (no-op locally; Supabase fills this in) ─────
export function onTripsChanged(cb) {
  window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); });
  return () => {}; // unsubscribe
}

/* ─────────────────────────────────────────────────────────────
   SUPABASE ADAPTER (fill in when config.BACKEND === "supabase")

   import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
   const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

   listTrips  → await db.from("trips").select("*, stops(*), contributions(*)")
                        .eq("gathering_id", gid).order("updated_at",{ascending:false})
   saveTrip   → upsert trip row, then upsert stops rows
   deposit    → insert into contributions
   onTripsChanged →
     db.channel("trips")
       .on("postgres_changes", { event:"*", schema:"public", table:"trips" }, cb)
       .on("presence", ...)   // who's editing, via Realtime Presence
       .subscribe();

   Notifications ("new trip planned", "someone deposited") ride on
   Supabase Database Webhooks → Edge Function → email/push. See README.
   ───────────────────────────────────────────────────────────── */
