// ─────────────────────────────────────────────────────────────
//  Planner — build/edit a trip. Day-grouped event timeline.
// ─────────────────────────────────────────────────────────────

import { config } from "./config.js";
import * as maps from "./providers/maps-google.js";
import * as store from "./store.js";
import { fmtMiles, fmtDuration, fmtTime, fmtDate, debounce, el } from "./util.js";
import { CATEGORIES, CATEGORY_ORDER, catDef, defaultStay, buildTimeline, ENDPOINT_ICONS } from "./events.js";

let map = null;
let clearRoute = () => {};
let trip = null;
let legs = [];                 // per-leg distance/time from the last route call
let mapClickMode = null;       // null | "origin" | "destination"
let pendingCategory = "sight"; // category chosen while adding a stop
let sortables = [];            // active SortableJS instances
const recompute = debounce(runRoute, 450);

export async function openPlanner(root, existingId) {
  trip = existingId ? structuredClone(store.getTrip(existingId)) : blankTrip();
  legs = [];
  root.innerHTML = template(trip);
  wireControls(root);
  renderTimeline(root);

  const mapEl = root.querySelector("#map");
  if (!config.GOOGLE_MAPS_API_KEY) { mapEl.classList.add("map--setup"); mapEl.innerHTML = setupNotice(); return; }

  try {
    await maps.loadMaps(config.GOOGLE_MAPS_API_KEY);
    map = maps.createMap(mapEl, config.DEFAULT_CENTER, config.DEFAULT_ZOOM);
    maps.createAutocomplete(root.querySelector("#origin-ac"), (pt) => setPoint("origin", pt, root));
    maps.createAutocomplete(root.querySelector("#dest-ac"), (pt) => setPoint("destination", pt, root));
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
  return {
    name: "", type: "line", origin: null, destination: null, stops: [],
    route: null, jar: { goal: 0, contributions: [] },
    startDate: null, departureTime: "08:00", dayStart: "09:00",
  };
}
const hasEnds = () => trip.origin && trip.destination;
const destLabel = () => (trip.type === "loop" ? "Turnaround point" : "Destination");

// ── Origin / destination ─────────────────────────────────────
function setPoint(which, pt, root) {
  trip[which] = pt;
  const cur = root.querySelector(which === "origin" ? "#origin-current" : "#dest-current");
  if (cur) cur.textContent = `Current: ${pt.label}`;
  recompute();
  renderTimeline(root);
}

function setClickMode(mode, root) {
  mapClickMode = mode;
  root.querySelectorAll("[data-pick]").forEach((b) =>
    b.classList.toggle("is-armed", b.dataset.pick === mode));
  if (map) map.getDiv().style.cursor = mode ? "crosshair" : "";
}

// ── Stop mutations ───────────────────────────────────────────
function addStop(root) {
  const slot = root.querySelector("#stop-add-slot");
  if (!config.GOOGLE_MAPS_API_KEY || !map) {
    slot.innerHTML = `<p class="hint">Add your Google key in config.js to search for stops.</p>`;
    return;
  }
  pendingCategory = "sight";
  slot.innerHTML = `
    <div class="adder">
      <div class="adder__cats">
        ${CATEGORY_ORDER.map((k) => `<button type="button" class="chip ${k === pendingCategory ? "is-on" : ""}" data-pcat="${k}">${CATEGORIES[k].icon} ${CATEGORIES[k].label}</button>`).join("")}
      </div>
      <div class="ac-slot" id="adder-ac"></div>
    </div>`;
  slot.querySelectorAll("[data-pcat]").forEach((b) =>
    b.onclick = () => { pendingCategory = b.dataset.pcat; slot.querySelectorAll("[data-pcat]").forEach((x) => x.classList.toggle("is-on", x.dataset.pcat === pendingCategory)); });
  maps.createAutocomplete(slot.querySelector("#adder-ac"), (pt) => {
    trip.stops.push({
      id: store.uid(), ...pt, notes: "", category: pendingCategory,
      tags: [], stayMin: null, cost: null,
      addedBy: store.getSession().me, surprise: false, reactions: {}, comments: [],
    });
    slot.replaceChildren();
    renderTimeline(root); recompute();
  });
}
function removeStop(id, root) { trip.stops = trip.stops.filter((s) => s.id !== id); renderTimeline(root); recompute(); }
function moveStop(id, dir, root) {
  const i = trip.stops.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= trip.stops.length) return;
  [trip.stops[i], trip.stops[j]] = [trip.stops[j], trip.stops[i]];
  renderTimeline(root); recompute();
}
const findStop = (id) => trip.stops.find((s) => s.id === id);

// ── The day-grouped timeline (editable) ──────────────────────
function renderTimeline(root) {
  const list = root.querySelector("#route-list");
  const tl = buildTimeline(trip, legs);

  list.innerHTML = tl.days.map((day) => {
    const header = `
      <div class="day-head">
        <span class="day-head__n">Day ${day.index + 1}</span>
        ${day.date ? `<span class="day-head__date">${fmtDate(day.date)}</span>` : ""}
        <span class="day-head__drive">${day.driveMeters ? `🚗 ${fmtMiles(day.driveMeters)} · ${fmtDuration(day.driveSeconds)}` : ""}</span>
      </div>`;
    const items = day.items.map((pt) => renderItem(pt)).join("");
    return `<div class="day">${header}<ol class="events">${items}</ol></div>`;
  }).join("") + `<div id="stop-add-slot"></div>`;

  wireTimeline(root);
}

function renderItem(pt) {
  if (pt.kind !== "stop") {
    const icon = ENDPOINT_ICONS[pt.kind] || "•";
    const role = pt.kind === "origin" || pt.kind === "return" ? "origin"
      : pt.kind === "apex" ? "apex" : "destination";
    const tag = pt.kind === "origin" ? "Depart" : pt.kind === "return" ? "Return" : pt.kind === "apex" ? "Turnaround" : "Arrive";
    return `
      <li class="ev ev--end ev--${role}">
        <span class="ev__pin">${icon}</span>
        <div class="ev__main">
          <div class="ev__top">
            <span class="ev__name">${escapeHtml(pt.place?.label || "—")}</span>
            <span class="ev__tag">${tag}</span>
            <span class="ev__eta">${fmtTime(pt.etaMin)}</span>
          </div>
        </div>
      </li>`;
  }

  const s = pt.stop;
  const me = store.getSession().me;

  // Surprise stop added by someone else: show a placeholder you can still
  // reorder or delete, but whose details stay hidden.
  if (s.surprise && s.addedBy && s.addedBy !== me) {
    return `
      <li class="ev ev--surprise" data-id="${s.id}">
        <button class="ev__pin ev__focus" data-focus="${s.id}" title="Surprise">🎁</button>
        <div class="ev__main">
          <div class="ev__top">
            <button class="ev__drag" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>
            <span class="ev__name">Surprise stop</span>
            <span class="ev__eta">${fmtTime(pt.etaMin)}</span>
            <span class="ev__acts"><button class="icon" data-remove="${s.id}" aria-label="Remove">✕</button></span>
          </div>
          <p class="ev__line">🎁 Hidden — added by ${escapeHtml(s.addedBy)}</p>
        </div>
      </li>`;
  }

  const cat = s.category || "sight";
  const def = catDef(cat);
  const stay = s.stayMin != null ? s.stayMin : defaultStay(cat);
  const catOpts = CATEGORY_ORDER.map((k) =>
    `<option value="${k}" ${k === cat ? "selected" : ""}>${CATEGORIES[k].icon} ${CATEGORIES[k].label}</option>`).join("");
  const tags = def.tags.map((t) =>
    `<label class="pill ${s.tags?.includes(t) ? "is-on" : ""}"><input type="checkbox" data-tag="${s.id}" value="${t}" ${s.tags?.includes(t) ? "checked" : ""}>${t}</label>`).join("");

  return `
    <li class="ev ev--${cat}" data-id="${s.id}">
      <button class="ev__pin ev__focus" data-focus="${s.id}" title="Show on map">${def.icon}</button>
      <div class="ev__main">
        <div class="ev__top">
          <button class="ev__drag" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>
          <select class="ev__cat" data-cat="${s.id}" aria-label="Category">${catOpts}</select>
          <span class="ev__name ev__focus" data-focus="${s.id}">${escapeHtml(s.label)}</span>
          <span class="ev__eta">${fmtTime(pt.etaMin)}</span>
          <span class="ev__acts">
            <button class="icon" data-remove="${s.id}" aria-label="Remove">✕</button>
          </span>
        </div>
        <div class="ev__meta">
          <label class="mini">stay <input type="number" min="0" step="15" data-stay="${s.id}" value="${stay}"> min</label>
          <label class="mini">$<input type="number" min="0" step="1" data-cost="${s.id}" value="${s.cost ?? ""}" placeholder="cost"></label>
          <label class="mini mini--check"><input type="checkbox" data-surprise="${s.id}" ${s.surprise ? "checked" : ""}> 🎁 Surprise</label>
        </div>
        <div class="ev__tags">${tags}</div>
        <input class="ev__notes" data-notes="${s.id}" placeholder="Add a note…" value="${escapeHtml(s.notes || "")}">
        <div class="ev__details">
          <input class="ev__mini-in" data-conf="${s.id}" placeholder="Confirmation #" value="${escapeHtml(s.confirmation || "")}">
          <input class="ev__mini-in" data-phone="${s.id}" placeholder="Phone" value="${escapeHtml(s.phone || "")}">
        </div>
        ${s.photoUrl ? `<img class="ev__photo" src="${s.photoUrl}" alt="" loading="lazy">` : ""}
      </div>
    </li>`;
}

function wireTimeline(root) {
  const list = root.querySelector("#route-list");
  list.querySelectorAll("[data-remove]").forEach((b) => b.onclick = () => removeStop(b.dataset.remove, root));
  list.querySelectorAll("[data-cat]").forEach((sel) => sel.onchange = () => {
    const s = findStop(sel.dataset.cat); if (!s) return;
    s.category = sel.value; s.stayMin = null; s.tags = [];  // reset to new category's defaults
    renderTimeline(root);                                   // day grouping may shift (sleep)
  });
  list.querySelectorAll("[data-stay]").forEach((inp) => inp.onchange = () => {
    const s = findStop(inp.dataset.stay); if (s) { s.stayMin = Number(inp.value) || 0; renderTimeline(root); }
  });
  list.querySelectorAll("[data-cost]").forEach((inp) => inp.oninput = () => {
    const s = findStop(inp.dataset.cost); if (s) s.cost = inp.value === "" ? null : Number(inp.value);
  });
  list.querySelectorAll("[data-notes]").forEach((inp) => inp.oninput = () => {
    const s = findStop(inp.dataset.notes); if (s) s.notes = inp.value;
  });
  list.querySelectorAll("[data-conf]").forEach((inp) => inp.oninput = () => {
    const s = findStop(inp.dataset.conf); if (s) s.confirmation = inp.value;
  });
  list.querySelectorAll("[data-phone]").forEach((inp) => inp.oninput = () => {
    const s = findStop(inp.dataset.phone); if (s) s.phone = inp.value;
  });
  list.querySelectorAll("[data-surprise]").forEach((cb) => cb.onchange = () => {
    const s = findStop(cb.dataset.surprise); if (!s) return;
    s.surprise = cb.checked;
    if (cb.checked && !s.addedBy) s.addedBy = store.getSession().me;
    renderTimeline(root);
  });
  list.querySelectorAll("[data-tag]").forEach((cb) => cb.onchange = () => {
    const s = findStop(cb.dataset.tag); if (!s) return;
    s.tags = s.tags || [];
    if (cb.checked) { if (!s.tags.includes(cb.value)) s.tags.push(cb.value); }
    else s.tags = s.tags.filter((t) => t !== cb.value);
    cb.closest(".pill")?.classList.toggle("is-on", cb.checked);
  });
  // Timeline → map: click a stop's pin or name to fly to it
  list.querySelectorAll("[data-focus]").forEach((elm) => elm.onclick = () => {
    const s = findStop(elm.dataset.focus);
    if (s && map) { map.panTo({ lat: s.lat, lng: s.lng }); map.setZoom(12); }
  });
  initDrag(root);
}

// Drag-to-reorder via SortableJS (loaded in index.html). Works across day
// lists; we rebuild the flat stop order from the DOM after each drop.
function initDrag(root) {
  sortables.forEach((s) => { try { s.destroy(); } catch {} });
  sortables = [];
  if (!window.Sortable) return;
  root.querySelectorAll("#route-list .events").forEach((ol) => {
    sortables.push(window.Sortable.create(ol, {
      group: "stops",
      draggable: ".ev[data-id]",
      handle: ".ev__drag",
      animation: 150,
      ghostClass: "ev--ghost",
      onEnd: () => reorderFromDom(root),
    }));
  });
}

function reorderFromDom(root) {
  const ids = Array.from(root.querySelectorAll("#route-list .ev[data-id]")).map((el) => el.dataset.id);
  trip.stops.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  renderTimeline(root); recompute();
}

// ── Route computation + draw ─────────────────────────────────
async function runRoute() {
  const readout = document.querySelector("#readout");
  if (!hasEnds() || !map) { legs = []; if (readout) readout.innerHTML = readoutHtml(null); return; }

  const waypoints = trip.type === "loop" ? [...trip.stops, trip.destination] : trip.stops;
  const destination = trip.type === "loop" ? trip.origin : trip.destination;

  try {
    readout?.classList.add("is-loading");
    const r = await maps.computeRoute({ origin: trip.origin, destination, waypoints });
    trip.route = { distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds };
    legs = r.legs || [];

    clearRoute();
    clearRoute = maps.drawRoute(map, { path: r.path, points: routePoints() }, { onPointClick: focusStopCard });
    if (readout) readout.innerHTML = readoutHtml(trip.route);
    renderTimeline(document.querySelector(".planner")?.parentElement || document);
  } catch (e) {
    legs = [];
    if (readout) readout.innerHTML = readoutHtml(null, e.message);
    renderTimeline(document.querySelector(".planner")?.parentElement || document);
  } finally {
    readout?.classList.remove("is-loading");
  }
}

function routePoints() {
  const pts = [{ ...trip.origin, role: "origin", label: trip.origin.label }];
  trip.stops.forEach((s, i) => pts.push({ ...s, role: "stop", index: i + 1, label: s.label, stopId: s.id }));
  pts.push({ ...trip.destination, role: trip.type === "loop" ? "apex" : "destination", label: trip.destination.label });
  return pts;
}

// Map → timeline: clicking a stop marker highlights and scrolls to its card.
function focusStopCard(pt) {
  if (!pt.stopId) return;
  const card = document.querySelector(`.ev[data-id="${pt.stopId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("ev--flash");
  setTimeout(() => card.classList.remove("ev--flash"), 1400);
}

// ── Controls / chrome ────────────────────────────────────────
function wireControls(root) {
  root.querySelector("#trip-name").oninput = (e) => (trip.name = e.target.value);

  root.querySelector("#start-date").onchange = (e) => { trip.startDate = e.target.value || null; renderTimeline(root); };
  root.querySelector("#depart-time").onchange = (e) => { trip.departureTime = e.target.value || "08:00"; renderTimeline(root); };
  root.querySelector("#day-start").onchange = (e) => { trip.dayStart = e.target.value || "09:00"; renderTimeline(root); };

  root.querySelectorAll("[data-type]").forEach((btn) => {
    btn.onclick = () => {
      trip.type = btn.dataset.type;
      root.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("is-on", b.dataset.type === trip.type));
      root.querySelector("#dest-label").textContent = destLabel();
      renderTimeline(root); recompute();
    };
  });

  root.querySelectorAll("[data-pick]").forEach((b) =>
    b.onclick = () => setClickMode(mapClickMode === b.dataset.pick ? null : b.dataset.pick, root));

  root.querySelector("#add-stop").onclick = () => addStop(root);

  root.querySelector("#save-trip").onclick = () => {
    if (!trip.name.trim()) { flash(root, "Give the trip a name first."); return; }
    if (!hasEnds()) { flash(root, "Set a start and an end point first."); return; }
    trip.legs = legs;   // persist per-leg data for the detail view's ETAs/subtotals
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

      <div class="dates">
        <label class="mini">Start date <input type="date" id="start-date" value="${t.startDate || ""}"></label>
        <label class="mini">Depart <input type="time" id="depart-time" value="${t.departureTime || "08:00"}"></label>
        <label class="mini">Days start <input type="time" id="day-start" value="${t.dayStart || "09:00"}"></label>
      </div>

      <div class="field">
        <span class="field__label">Start</span>
        <div class="field__row">
          <div id="origin-ac" class="ac-slot"></div>
          <button class="pick" data-pick="origin" title="Pick on map">📍</button>
        </div>
        <p class="field__current" id="origin-current">${t.origin ? "Current: " + escapeHtml(t.origin.label) : ""}</p>
      </div>

      <div class="field">
        <span class="field__label" id="dest-label">${t.type === "loop" ? "Turnaround point" : "Destination"}</span>
        <div class="field__row">
          <div id="dest-ac" class="ac-slot"></div>
          <button class="pick" data-pick="destination" title="Pick on map">📍</button>
        </div>
        <p class="field__current" id="dest-current">${t.destination ? "Current: " + escapeHtml(t.destination.label) : ""}</p>
      </div>

      <div id="route-list" class="route-list"></div>

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

function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
