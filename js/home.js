// ─────────────────────────────────────────────────────────────
//  Home — the trip list, and a single trip's detail view (with jar).
// ─────────────────────────────────────────────────────────────

import * as store from "./store.js";
import { renderJar } from "./jar.js";
import { fmtMiles, fmtDuration } from "./util.js";

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
  const hero = t.origin?.photoUrl || t.destination?.photoUrl || t.stops.find((s) => s.photoUrl)?.photoUrl;
  return `
    <a class="trip-card" href="#/trip/${t.id}">
      <div class="trip-card__media">${hero ? `<img src="${hero}" alt="" loading="lazy">` : `<span class="trip-card__badge">${t.type === "loop" ? "Loop" : "Line"}</span>`}</div>
      <div class="trip-card__body">
        <h3 class="trip-card__name">${escapeHtml(t.name || "Untitled trip")}</h3>
        <p class="trip-card__route">${escapeHtml(t.origin?.label || "—")} <span class="arrow">${t.type === "loop" ? "↺" : "→"}</span> ${escapeHtml(t.destination?.label || "—")}</p>
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

  const stops = [
    { role: "start", label: t.origin?.label },
    ...t.stops.map((s, i) => ({ role: "stop", n: i + 1, label: s.label, notes: s.notes, photo: s.photoUrl })),
    { role: t.type === "loop" ? "apex" : "end", label: t.destination?.label },
    ...(t.type === "loop" ? [{ role: "start", label: `back to ${t.origin?.label || "start"}`, muted: true }] : []),
  ];

  root.innerHTML = `
    <section class="detail">
      <a class="back" href="#/">← Trips</a>
      <header class="detail__head">
        <h1>${escapeHtml(t.name || "Untitled trip")}</h1>
        <div class="detail__stats">
          <span class="mono">${t.route ? fmtMiles(t.route.distanceMeters) : "—"}</span>
          ${t.route ? `<span class="mono">${fmtDuration(t.route.durationSeconds)}</span>` : ""}
          <span>${t.stops.length} stop${t.stops.length === 1 ? "" : "s"}</span>
        </div>
        <div class="detail__actions">
          <a class="btn btn--ghost" href="#/plan/${t.id}">Edit plan</a>
          <button class="btn btn--quiet" data-del="${t.id}">Delete</button>
        </div>
      </header>

      <div class="detail__cols">
        <ol class="route-list route-list--read">
          ${stops.map((s) => `
            <li class="node node--${s.role === "start" ? "origin" : s.role === "end" ? "destination" : s.role === "apex" ? "apex" : "stop"}">
              <span class="node__pin"></span>
              <div class="node__body">
                <div class="node__row">
                  ${s.n ? `<span class="node__num">${s.n}</span>` : ""}
                  <span class="node__label ${s.muted ? "node__label--muted" : ""}">${escapeHtml(s.label || "—")}</span>
                </div>
                ${s.notes ? `<p class="node__noteline">${escapeHtml(s.notes)}</p>` : ""}
                ${s.photo ? `<img class="node__photo" src="${s.photo}" alt="" loading="lazy">` : ""}
              </div>
            </li>`).join("")}
        </ol>

        <div id="jar-slot"></div>
      </div>
    </section>`;

  renderJar(root.querySelector("#jar-slot"), t.id);
  root.querySelector("[data-del]")?.addEventListener("click", () => {
    if (confirm("Delete this trip for the whole Gathering?")) { store.deleteTrip(id); location.hash = "#/"; }
  });
}

function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
