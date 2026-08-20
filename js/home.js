// ─────────────────────────────────────────────────────────────
//  Home — the trip list, and a single trip's detail view (with jar).
// ─────────────────────────────────────────────────────────────

import * as store from "./store.js";
import { renderJar } from "./jar.js";
import { fmtMiles, fmtDuration, fmtDate, fmtTime, countdownLabel } from "./util.js";
import { buildTimeline, catDef, ENDPOINT_ICONS } from "./events.js";

export function renderHome(root) {
  const trips = store.listTrips();
  const { gathering } = store.getSession();

  root.innerHTML = `
    <section class="home">
      <header class="home__head">
        <div>
          <p class="eyebrow">${escapeHtml(gathering?.name || "Your Gathering")}</p>
          <h1 class="home__title">Trips</h1>
        </div>
        <a class="btn btn--solid" href="#/plan">Plan a trip</a>
      </header>
      ${trips.length ? `<div class="trip-grid">${trips.map(card).join("")}</div>` : empty()}
    </section>`;
}

function card(t) {
  const miles = t.route ? fmtMiles(t.route.distanceMeters) : "—";
  const time = t.route ? fmtDuration(t.route.durationSeconds) : "";
  const totals = store.jarTotals(t);
  const pct = totals.goal ? Math.min(100, Math.round((totals.saved / totals.goal) * 100)) : 0;
  // Prefer a photo that's distinctive to THIS trip (destination or a stop)
  // over the origin — trips sharing a start city would otherwise collide.
  const hero = t.destination?.photoUrl || t.stops.find((s) => s.photoUrl)?.photoUrl || t.origin?.photoUrl;
  const tl = buildTimeline(t, t.legs || []);
  const dateBits = [];
  if (t.startDate) dateBits.push(fmtDate(t.startDate));
  dateBits.push(`${tl.numDays} day${tl.numDays === 1 ? "" : "s"}`);
  const countdown = t.startDate ? countdownLabel(t.startDate) : "";

  return `
    <a class="trip-card" href="#/trip/${t.id}">
      <div class="trip-card__media">
        ${hero ? `<img src="${hero}" alt="" loading="lazy">` : `<span class="trip-card__badge">${t.type === "loop" ? "Loop" : "Line"}</span>`}
        ${countdown ? `<span class="trip-card__count">${countdown}</span>` : ""}
      </div>
      <div class="trip-card__body">
        <h3 class="trip-card__name">${escapeHtml(t.name || "Untitled trip")}</h3>
        <p class="trip-card__route">${escapeHtml(t.origin?.label || "—")} <span class="arrow">${t.type === "loop" ? "↺" : "→"}</span> ${escapeHtml(t.destination?.label || "—")}</p>
        <p class="trip-card__meta">${dateBits.join(" · ")}</p>
        <p class="trip-card__meta"><span class="mono">${miles}</span>${time ? ` · <span class="mono">${time}</span>` : ""} · ${t.stops.length} stop${t.stops.length === 1 ? "" : "s"}</p>
        ${totals.goal ? `<div class="mini-bar"><span style="width:${pct}%"></span></div>` : ""}
      </div>
    </a>`;
}

function empty() {
  return `<div class="empty">
    <div class="empty__mark"></div>
    <h2>No trips yet</h2>
    <p>Plan the first one and it shows up here for everyone in the Gathering.</p>
    <a class="btn btn--solid" href="#/plan">Plan a trip</a>
  </div>`;
}

export function renderTrip(root, id) {
  const t = store.getTrip(id);
  if (!t) { root.innerHTML = `<div class="empty"><h2>That trip's gone</h2><a class="btn" href="#/">Back to trips</a></div>`; return; }

  const tl = buildTimeline(t, t.legs || []);

  const dateLine = t.startDate
    ? `${fmtDate(t.startDate)}${tl.days.length > 1 ? " – " + fmtDate(tl.days[tl.days.length - 1].date) : ""}`
    : `${tl.numDays} day${tl.numDays === 1 ? "" : "s"}`;

  root.innerHTML = `
    <section class="detail">
      <a class="back" href="#/">← Trips</a>
      <header class="detail__head">
        <h1>${escapeHtml(t.name || "Untitled trip")}</h1>
        <p class="detail__dates">${dateLine}${t.startDate ? ` · <span class="mono">${countdownLabel(t.startDate)}</span>` : ""}</p>
        <div class="detail__stats">
          <span class="mono">${t.route ? fmtMiles(t.route.distanceMeters) : "—"}</span>
          ${t.route ? `<span class="mono">${fmtDuration(t.route.durationSeconds)}</span>` : ""}
          <span>${t.stops.length} stop${t.stops.length === 1 ? "" : "s"}</span>
        </div>
        <div class="detail__actions">
          <a class="btn btn--ghost" href="#/plan/${t.id}">Edit plan</a>
          <button class="btn btn--ghost" data-dup="${t.id}">Duplicate</button>
          <button class="btn btn--quiet" data-del="${t.id}">Delete</button>
        </div>
      </header>

      <div class="detail__cols">
        <div class="timeline">
          ${tl.days.map(readDay).join("")}
        </div>
        <div id="jar-slot"></div>
      </div>
    </section>`;

  renderJar(root.querySelector("#jar-slot"), t.id);
  root.querySelector("[data-dup]")?.addEventListener("click", () => {
    const copy = store.duplicateTrip(id);
    if (copy) location.hash = `#/plan/${copy.id}`;
  });
  root.querySelector("[data-del]")?.addEventListener("click", () => {
    if (confirm("Delete this trip for the whole Gathering?")) { store.deleteTrip(id); location.hash = "#/"; }
  });
}

function readDay(day) {
  const items = day.items.map(readItem).join("");
  return `
    <div class="day day--read">
      <div class="day-head">
        <span class="day-head__n">Day ${day.index + 1}</span>
        ${day.date ? `<span class="day-head__date">${fmtDate(day.date)}</span>` : ""}
        <span class="day-head__drive">${day.driveMeters ? `🚗 ${fmtMiles(day.driveMeters)} · ${fmtDuration(day.driveSeconds)}` : ""}</span>
      </div>
      <ol class="events">${items}</ol>
    </div>`;
}

function readItem(pt) {
  if (pt.kind !== "stop") {
    const icon = ENDPOINT_ICONS[pt.kind] || "•";
    const tag = pt.kind === "origin" ? "Depart" : pt.kind === "return" ? "Return" : pt.kind === "apex" ? "Turnaround" : "Arrive";
    const role = pt.kind === "origin" || pt.kind === "return" ? "origin" : pt.kind === "apex" ? "apex" : "destination";
    return `
      <li class="ev ev--end ev--${role}">
        <span class="ev__pin">${icon}</span>
        <div class="ev__main"><div class="ev__top">
          <span class="ev__name">${escapeHtml(pt.place?.label || "—")}</span>
          <span class="ev__tag">${tag}</span>
          <span class="ev__eta">${fmtTime(pt.etaMin)}</span>
        </div></div>
      </li>`;
  }
  const s = pt.stop;
  const def = catDef(s.category);
  const tags = (s.tags || []).map((x) => `<span class="pill pill--read is-on">${escapeHtml(x)}</span>`).join("");
  return `
    <li class="ev ev--${s.category || "sight"}">
      <span class="ev__pin">${def.icon}</span>
      <div class="ev__main">
        <div class="ev__top">
          <span class="ev__name">${escapeHtml(s.label)}</span>
          <span class="ev__eta">${fmtTime(pt.etaMin)}</span>
        </div>
        ${tags ? `<div class="ev__tags">${tags}</div>` : ""}
        ${s.cost != null ? `<p class="ev__cost mono">$${s.cost}</p>` : ""}
        ${s.confirmation ? `<p class="ev__line">📋 ${escapeHtml(s.confirmation)}</p>` : ""}
        ${s.phone ? `<p class="ev__line">📞 ${escapeHtml(s.phone)}</p>` : ""}
        ${s.notes ? `<p class="ev__noteline">${escapeHtml(s.notes)}</p>` : ""}
        ${s.photoUrl ? `<img class="ev__photo" src="${s.photoUrl}" alt="" loading="lazy">` : ""}
      </div>
    </li>`;
}

function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
