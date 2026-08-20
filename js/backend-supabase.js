// ─────────────────────────────────────────────────────────────
//  Supabase backend — all network/auth code lives here.
//  Loaded only when config.BACKEND === "supabase". store.js keeps a
//  synchronous cache and calls these async functions to load/persist.
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { config } from "./config.js";

let sb = null;
export function client() {
  if (!sb) sb = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  return sb;
}

// ── Auth (email + password) ──────────────────────────────────
export async function signUp(email, password, displayName) {
  const { data, error } = await client().auth.signUp({
    email, password, options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  return data;
}
export async function signIn(email, password) {
  const { data, error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signOut() { await client().auth.signOut(); }
export async function getUser() {
  const { data } = await client().auth.getUser();
  return data?.user || null;
}

// ── Membership / gathering ───────────────────────────────────
export async function getMembership() {
  const { data, error } = await client()
    .from("memberships")
    .select("gathering_id, display_name, gatherings(name, join_code)")
    .limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    gatheringId: data.gathering_id,
    displayName: data.display_name,
    name: data.gatherings?.name,
    joinCode: data.gatherings?.join_code,
  };
}
export async function createGathering(name, displayName) {
  const { data, error } = await client().rpc("create_gathering", { p_name: name, p_display: displayName });
  if (error) throw error;
  const g = Array.isArray(data) ? data[0] : data;
  return { gatheringId: g.id, name: g.name, joinCode: g.join_code, displayName };
}
export async function joinByCode(code, displayName) {
  const { data, error } = await client().rpc("join_gathering", { p_code: code, p_display: displayName });
  if (error) throw error;
  const g = Array.isArray(data) ? data[0] : data;
  return { gatheringId: g.id, name: g.name, joinCode: g.join_code, displayName };
}

// ── Trips ────────────────────────────────────────────────────
export async function loadTrips(gatheringId) {
  const { data: trips, error } = await client().from("trips").select("*").eq("gathering_id", gatheringId);
  if (error) throw error;
  const ids = (trips || []).map((t) => t.id);
  let contribs = [];
  if (ids.length) {
    const { data: c } = await client().from("contributions").select("*").in("trip_id", ids);
    contribs = c || [];
  }
  return (trips || []).map((row) => rowToTrip(row, contribs.filter((c) => c.trip_id === row.id)));
}

function rowToTrip(r, contribs) {
  return {
    id: r.id, gatheringId: r.gathering_id, name: r.name, type: r.type,
    origin: r.origin, destination: r.destination,
    startDate: r.start_date, departureTime: r.departure_time || "08:00", dayStart: r.day_start || "09:00",
    route: r.distance_m != null ? { distanceMeters: r.distance_m, durationSeconds: r.duration_s } : null,
    legs: r.legs || [], stops: r.stops || [],
    jar: {
      goal: Number(r.jar_goal) || 0,
      contributions: contribs.map((c) => ({ id: c.id, member: c.member, amount: Number(c.amount), at: c.created_at })),
    },
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function upsertTrip(t, gatheringId, userId) {
  const row = {
    id: t.id, gathering_id: gatheringId, name: t.name || "", type: t.type || "line",
    origin: t.origin, destination: t.destination,
    start_date: t.startDate || null, departure_time: t.departureTime || "08:00", day_start: t.dayStart || "09:00",
    distance_m: t.route?.distanceMeters ?? null, duration_s: t.route?.durationSeconds ?? null,
    legs: t.legs || [], stops: t.stops || [], jar_goal: t.jar?.goal || 0,
    created_by: t.createdBy || userId || null,
  };
  const { error } = await client().from("trips").upsert(row);
  if (error) throw error;
}
export async function removeTrip(id) {
  const { error } = await client().from("trips").delete().eq("id", id);
  if (error) throw error;
}
export async function insertContribution(tripId, member, amount) {
  const { error } = await client().from("contributions").insert({ trip_id: tripId, member, amount });
  if (error) throw error;
}
export async function updateGoal(tripId, goal) {
  const { error } = await client().from("trips").update({ jar_goal: goal }).eq("id", tripId);
  if (error) throw error;
}

// ── Realtime: any trip/contribution change → onChange() ──────
export function subscribe(gatheringId, onChange) {
  const ch = client()
    .channel("gathering-" + gatheringId)
    .on("postgres_changes", { event: "*", schema: "public", table: "trips", filter: `gathering_id=eq.${gatheringId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "contributions" }, onChange)
    .subscribe();
  return () => client().removeChannel(ch);
}
