// ─────────────────────────────────────────────────────────────
//  Events — the trip's vocabulary and its timeline math.
//
//  A "stop" is now an EVENT: a place + a category + times + tags.
//  This module owns the category definitions and the pure logic that
//  turns a trip (origin, stops, destination) + route legs into a
//  day-grouped timeline with arrival estimates and per-day subtotals.
//  No DOM here on purpose — it's unit-testable and shared by the
//  planner (editable) and the trip detail (read-only) views.
// ─────────────────────────────────────────────────────────────

import { parseTime, addDays } from "./util.js";

export const CATEGORIES = {
  sight: { label: "Sight", icon: "📍", stay: 60,  tags: ["Must-see", "Photo op", "Free entry", "Timed entry"] },
  food:  { label: "Food",  icon: "🍽️", stay: 75,  tags: ["Reservation", "Live music", "Fast food", "Outdoor seating", "Bar"] },
  sleep: { label: "Sleep", icon: "🛏️", stay: 0,   endsDay: true, tags: ["Booked", "Paid", "Free parking", "Breakfast", "Pet friendly"] },
  fun:   { label: "Fun",   icon: "🎟️", stay: 120, tags: ["Tickets bought", "Timed entry", "Reservation", "Family friendly"] },
  gas:   { label: "Gas",   icon: "⛽", stay: 15,  tags: ["EV charging", "Snacks", "Restroom"] },
  shop:  { label: "Shop",  icon: "🛍️", stay: 45,  tags: ["Groceries", "Souvenirs", "Open late"] },
};

export const CATEGORY_ORDER = ["sight", "food", "sleep", "fun", "gas", "shop"];

// Icons for the fixed endpoints (not user-chosen categories).
export const ENDPOINT_ICONS = { origin: "🚩", destination: "🏁", apex: "🔄", return: "🏠" };

export function catDef(key) {
  return CATEGORIES[key] || CATEGORIES.sight;
}
export function defaultStay(catKey) {
  return catDef(catKey).stay;
}

// Day index for each stop, derived from Sleep events: a Sleep closes its
// day, so everything after it belongs to the next day.
export function dayByStop(stops = []) {
  const out = [];
  let d = 0;
  for (const s of stops) {
    out.push(d);
    if ((s.category || "sight") === "sleep") d++;
  }
  return out;
}

// Build the full timeline. `legs[i]` is the drive from point i to point i+1,
// shaped { distanceMeters, durationSeconds }. Returns days with items,
// arrival estimates (etaMin, minutes-since-midnight), and per-day drive
// subtotals. Degrades gracefully when legs is empty (no route yet).
export function buildTimeline(trip, legs = []) {
  const stops = trip.stops || [];
  const dayOf = dayByStop(stops);
  const finalDay = dayOf.length ? dayOf[dayOf.length - 1] + ((stops[stops.length - 1]?.category === "sleep") ? 1 : 0) : 0;

  // Ordered points: origin → stops → destination (→ back to origin for loops)
  const points = [];
  points.push({ id: "__origin", kind: "origin", place: trip.origin, day: 0, stayMin: 0 });
  stops.forEach((s, i) => points.push({
    id: s.id, kind: "stop", place: s, stop: s, day: dayOf[i],
    category: s.category || "sight",
    stayMin: s.stayMin != null ? s.stayMin : defaultStay(s.category),
    tags: s.tags || [], cost: s.cost,
  }));
  if (trip.destination) {
    points.push({
      id: "__dest", day: finalDay, stayMin: 0,
      kind: trip.type === "loop" ? "apex" : "destination",
      place: trip.destination,
    });
    if (trip.type === "loop") {
      points.push({ id: "__return", kind: "return", place: trip.origin, day: finalDay, stayMin: 0 });
    }
  }

  // Arrival estimates. Each morning starts fresh at the day's start time;
  // within a day the clock accrues drive time + how long you linger.
  const dep0 = parseTime(trip.departureTime || "08:00");
  const dayStart = parseTime(trip.dayStart || "09:00");
  const startOf = (d) => (d === 0 ? dep0 : dayStart);

  let prevDepart = null, prevDay = -1;
  points.forEach((pt, i) => {
    const driveMin = i > 0 ? Math.round((legs[i - 1]?.durationSeconds || 0) / 60) : 0;
    if (i === 0) pt.etaMin = startOf(0);
    else if (pt.day !== prevDay) pt.etaMin = startOf(pt.day) + driveMin;   // new day: leave lodging, then drive
    else pt.etaMin = prevDepart + driveMin;                                // same day: after last departure + drive
    pt.departMin = pt.etaMin + (pt.stayMin || 0);
    prevDepart = pt.departMin;
    prevDay = pt.day;
  });

  // Group into days; a leg counts toward the day of its destination point.
  const days = [];
  for (let di = 0; di <= finalDay; di++) {
    let meters = 0, seconds = 0;
    points.forEach((pt, i) => {
      if (i > 0 && pt.day === di) {
        meters += legs[i - 1]?.distanceMeters || 0;
        seconds += legs[i - 1]?.durationSeconds || 0;
      }
    });
    days.push({
      index: di,
      date: trip.startDate ? addDays(trip.startDate, di) : null,
      items: points.filter((p) => p.day === di),
      driveMeters: meters, driveSeconds: seconds,
      startMin: startOf(di),
    });
  }

  return {
    days,
    totalMeters: legs.reduce((s, l) => s + (l.distanceMeters || 0), 0),
    totalSeconds: legs.reduce((s, l) => s + (l.durationSeconds || 0), 0),
    numDays: finalDay + 1,
  };
}

// Normalize a stop to the event shape (used on load for old trips).
export function migrateStop(s) {
  return {
    id: s.id, label: s.label, lat: s.lat, lng: s.lng,
    placeId: s.placeId || null, photoUrl: s.photoUrl || null,
    notes: s.notes || "",
    confirmation: s.confirmation || "",
    phone: s.phone || "",
    category: s.category || "sight",
    tags: Array.isArray(s.tags) ? s.tags : [],
    stayMin: s.stayMin != null ? s.stayMin : null,
    cost: s.cost != null ? s.cost : null,
    addedBy: s.addedBy || null,
    surprise: !!s.surprise,
    reactions: s.reactions && typeof s.reactions === "object" ? s.reactions : {},
    comments: Array.isArray(s.comments) ? s.comments : [],
  };
}

// Emoji reaction set for stops.
export const REACTIONS = ["👍", "❤️", "🔥", "😋", "👎"];

// Should `viewer` (a display name) see this stop's real details?
export function canSeeStop(stop, viewer) {
  return !stop.surprise || !stop.addedBy || stop.addedBy === viewer;
}
