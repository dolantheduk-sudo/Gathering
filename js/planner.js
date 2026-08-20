// ─────────────────────────────────────────────────────────────
//  Planner — build/edit a trip. The heart of the app.
// ─────────────────────────────────────────────────────────────

import { config } from "./config.js";
import * as maps from "./providers/maps-google.js";
import * as store from "./store.js";
import { fmtMiles, fmtDuration, debounce, el } from "./util.js";

let map = null;
let clearRoute = () => {};
let trip = null;
let mapClickMode = null;        // null | "origin" | "destination"
const recompute = debounce(runRoute, 450);

export async function openPlanner(root, existingId) {
  trip = existingId ? structuredClone(store.getTrip(existingId)) : blankTrip();
  root.innerHTML = template(trip);
  wireControls(root);
  renderStops(root);

  const mapEl = root.querySelector("#map");
  if (!config.GOOGLE_MAPS_API_KEY) { mapEl.classList.add("map--setup"); mapEl.innerHTML = setupNotice(); return; }

  try {
    await maps.loadMaps(config.GOOGLE_MAPS_API_KEY);
    map = maps.createMap(mapEl, config.DEFAULT_CENTER, config.DEFAULT_ZOOM);
    maps.attachSearch(root.querySelector("#origin-input"), (pt) => setPoint("origin", pt, root));
    maps.attachSearch(root.querySelector("#dest-input"), (pt) => setPoint("destination", pt, root));
    map.addListener("click", async (e) => {
      if (!mapClickMode) return;
      const pt = await maps.pointFromClick(e.latLng);
      setPoint(mapClickMode, pt, root);
      setClickMode(null, root);
    });
    if (hasEnds()) runRoute();
  } catch (err) {
    mapEl.classList.add("map--setup");
    mapEl.innerHTML = setupNotice(err.message === "NO_KEY");
  }
}

function blankTrip() {
  return { name: "", type: "line", origin: null, destination: null, stops: [], route: null, jar: { goal: 0, contributions: [] } };
}
const hasEnds = () => trip.origin && trip.destination;
const destLabel = () => (trip.type === "loop" ? "Turnaround point" : "Destination");

// ── Setting origin / destination ─────────────────────────────
function setPoint(which, pt, root) {
  trip[which] = pt;
  const input = root.querySelector(which === "origin" ? "#origin-input" : "#dest-input");
  input.value = pt.label;
  recompute();
  renderStops(root);
}

function setClickMode(mode, root) {
  mapClickMode = mode;
  root.querySelectorAll("[data-pick]").forEach((b) =>
    b.classList.toggle("is-armed", b.dataset.pick === mode));
  if (map) map.getDiv().style.cursor = mode ? "crosshair" : "";
}

// ── Stops ────────────────────────────────────────────────────
function addStop(root) {
  const wrap = el("div", "stop-adder");
  const input = el("input", "input");
  input.placeholder = "Search a place — restaurant, park, landmark…";
  wrap.append(input);
  root.querySelector("#stop-add-slot").replaceChildren(wrap);
  input.focus();
  if (config.GOOGLE_MAPS_API_KEY && map) {
    maps.attachSearch(input, (pt) => {
      trip.stops.push({ id: store.uid(), ...pt, notes: "" });
      root.querySelector("#stop-add-slot").replaceChildren();
      renderStops(root); recompute();
    });
  }
}
function removeStop(id, root) { trip.stops = trip.stops.filter((s) => s.id !== id); renderStops(root); recompute(); }
function moveStop(id, dir, root) {
  const i = trip.stops.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= trip.stops.length) return;
  [trip.stops[i], trip.stops[j]] = [trip.stops[j], trip.stops[i]];
  renderStops(root); recompute();
}

// ── The signature: itinerary drawn as a vertical route ───────
function renderStops(root) {
  const list = root.querySelector("#route-list");
  const node = (role, label, extra = "") => `
    <li class="node node--${role}">
      <span class="node__pin"></span>
      <div class="node__body">${label}${extra}</div>
    </li>`;

  const originHtml = node("origin", trip.origin
    ? `<span class="node__label">${escapeHtml(trip.origin.label)}</span><span class="node__tag">Start</span>`
    : `<span class="node__label node__label--empty">Set a starting point</span>`);

  const stopsHtml = trip.stops.map((s, i) => node("stop", `
    <div class="node__row">
      <span class="node__num">${i + 1}</span>
      <span class="node__label">${escapeHtml(s.label)}</span>
      <span class="node__acts">
        <button class="icon" data-move="${s.id}" data-dir="-1" aria-label="Move up">↑</button>
        <button class="icon" data-move="${s.id}" data-dir="1" aria-label="Move down">↓</button>
        <button class="icon" data-remove="${s.id}" aria-label="Remove">✕</button>
      </span>
    </div>
    <input class="node__notes" data-notes="${s.id}" placeholder="Add a note…" value="${escapeHtml(s.notes || "")}">
    ${s.photoUrl ? `<img class="node__photo" src="${s.photoUrl}" alt="" loading="lazy">` : ""}
  `)).join("");

  const destHtml = node(trip.type === "loop" ? "apex" : "destination", trip.destination
    ? `<span class="node__label">${escapeHtml(trip.destination.label)}</span><span class="node__tag">${destLabel()}</span>`
    : `<span class="node__label node__label--empty">Set ${destLabel().toLowerCase()}</span>`);

  const backHome = trip.type === "loop"
    ? node("origin", `<span class="node__label node__label--muted">…back to ${trip.origin ? escapeHtml(trip.origin.label) : "start"}</span>`)
    : "";

  list.innerHTML = originHtml + stopsHtml + destHtml + backHome + `<div id="stop-add-slot"></div>`;

  list.querySelectorAll("[data-move]").forEach((b) =>
    b.onclick = () => moveStop(b.dataset.move, Number(b.dataset.dir), root));
  list.querySelectorAll("[data-remove]").forEach((b) =>
    b.onclick = () => removeStop(b.dataset.remove, root));
  list.querySelectorAll("[data-notes]").forEach((inp) =>
    inp.oninput = () => { const s = trip.stops.find((x) => x.id === inp.dataset.notes); if (s) s.notes = inp.value; });
}

// ── Route computation + draw ─────────────────────────────────
async function runRoute() {
  const readout = document.querySelector("#readout");
  if (!hasEnds() || !map) { if (readout) readout.innerHTML = readoutHtml(null); return; }

  const waypoints = trip.type === "loop"
    ? [...trip.stops, trip.destination]           // loop: everything is a waypoint, end back at origin
    : trip.stops;
  const destination = trip.type === "loop" ? trip.origin : trip.destination;

  try {
    readout?.classList.add("is-loading");
    const r = await maps.computeRoute({ origin: trip.origin, destination, waypoints });
    trip.route = { distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds };

    clearRoute();
    clearRoute = maps.drawRoute(map, { path: r.path, points: routePoints() });
    if (readout) readout.innerHTML = readoutHtml(trip.route);
  } catch (e) {
    if (readout) readout.innerHTML = readoutHtml(null, e.message);
  } finally {
    readout?.classList.remove("is-loading");
  }
}

function routePoints() {
  const pts = [{ ...trip.origin, role: "origin", label: trip.origin.label }];
  trip.stops.forEach((s, i) => pts.push({ ...s, role: "stop", index: i + 1, label: s.label }));
  pts.push({ ...trip.destination, role: trip.type === "loop" ? "apex" : "destination", label: trip.destination.label });
  return pts;
}

// ── Controls / chrome ────────────────────────────────────────
function wireControls(root) {
  root.querySelector("#trip-name").oninput = (e) => (trip.name = e.target.value);

  root.querySelectorAll("[data-type]").forEach((btn) => {
    btn.onclick = () => {
      trip.type = btn.dataset.type;
      root.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("is-on", b.dataset.type === trip.type));
      root.querySelector("#dest-label").textContent = destLabel();
      root.querySelector("#dest-input").placeholder = `Search ${destLabel().toLowerCase()}…`;
      renderStops(root); recompute();
    };
  });

  root.querySelectorAll("[data-pick]").forEach((b) =>
    b.onclick = () => setClickMode(mapClickMode === b.dataset.pick ? null : b.dataset.pick, root));

  root.querySelector("#add-stop").onclick = () => addStop(root);

  root.querySelector("#save-trip").onclick = () => {
    if (!trip.name.trim()) { flash(root, "Give the trip a name first."); return; }
    if (!hasEnds()) { flash(root, "Set a start and an end point first."); return; }
    const saved = store.saveTrip(trip);
    flash(root, "Saved for the whole Gathering.");
    location.hash = `#/trip/${saved.id}`;
  };
}

// ── Markup ───────────────────────────────────────────────────
function template(t) {
  return `
  <section class="planner">
    <div class="planner__panel">
      <input id="trip-name" class="trip-name" placeholder="Name this trip" value="${escapeHtml(t.name)}">

      <div class="seg" role="tablist" aria-label="Trip shape">
        <button class="seg__btn ${t.type === "line" ? "is-on" : ""}" data-type="line">Line — A to B</button>
        <button class="seg__btn ${t.type === "loop" ? "is-on" : ""}" data-type="loop">Loop — out & back</button>
      </div>

      <label class="field">
        <span class="field__label">Start</span>
        <div class="field__row">
          <input id="origin-input" class="input" placeholder="Search a starting point…" value="${escapeHtml(t.origin?.label || "")}">
          <button class="pick" data-pick="origin" title="Pick on map">📍</button>
        </div>
      </label>

      <label class="field">
        <span class="field__label" id="dest-label">${t.type === "loop" ? "Turnaround point" : "Destination"}</span>
        <div class="field__row">
          <input id="dest-input" class="input" placeholder="Search destination…" value="${escapeHtml(t.destination?.label || "")}">
          <button class="pick" data-pick="destination" title="Pick on map">📍</button>
        </div>
      </label>

      <ol id="route-list" class="route-list"></ol>

      <button id="add-stop" class="btn btn--ghost">+ Add a stop</button>

      <div class="panel__foot">
        <button id="save-trip" class="btn btn--solid">Save trip</button>
        <div id="flash" class="flash" role="status"></div>
      </div>
    </div>

    <div class="planner__map">
      <div id="map" class="map"></div>
      <div id="readout" class="readout">${readoutHtml(t.route)}</div>
    </div>
  </section>`;
}

function readoutHtml(route, err) {
  if (err) return `<span class="readout__err">Couldn't route that — ${escapeHtml(err)}</span>`;
  if (!route) return `<span class="readout__hint">Set a start and end to see distance & time</span>`;
  return `
    <div class="readout__stat"><span class="readout__num">${fmtMiles(route.distanceMeters)}</span><span class="readout__unit">total</span></div>
    <div class="readout__stat"><span class="readout__num">${fmtDuration(route.durationSeconds)}</span><span class="readout__unit">drive time</span></div>`;
}

function setupNotice(noKey = true) {
  return `<div class="setup">
    <h3>Map needs a Google key</h3>
    <p>${noKey ? "Add your Google Maps key in <code>js/config.js</code>." : "That key was rejected — check it's enabled for Maps JavaScript + Places (New) and restricted to this site."}</p>
    <p class="setup__aside">Everything else works without it — you just won't see the map or search until it's set.</p>
  </div>`;
}

function flash(root, msg) {
  const f = root.querySelector("#flash");
  f.textContent = msg; f.classList.add("show");
  setTimeout(() => f.classList.remove("show"), 2600);
}

function escapeHtml(s = "") { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
