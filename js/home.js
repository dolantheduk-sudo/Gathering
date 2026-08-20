// ─────────────────────────────────────────────────────────────
//  Home — trip list + trip detail (timeline, reactions, comments,
//  surprise stops, checklist, jar).
// ─────────────────────────────────────────────────────────────

import * as store from "./store.js";
import { renderJar } from "./jar.js";
import { fmtMiles, fmtDuration, fmtDate, fmtTime, countdownLabel } from "./util.js";
import { buildTimeline, catDef, ENDPOINT_ICONS, REACTIONS, canSeeStop } from "./events.js";

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
  const hero = t.destination?.photoUrl || t.stops.find((s) => s.photoUrl && !s.surprise)?.photoUrl || t.origin?.photoUrl;
  const tl = buildTimeline(t, t.legs || []);
  const bits = [];
  if (t.startDate) bits.push(fmtDate(t.startDate));
  bits.push(`${tl.numDays} day${tl.numDays === 1 ? "" : "s"}`);
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
        <p class="trip-card__meta">${bits.join(" · ")}</p>
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
  const me = store.getSession().me;
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
        <div class="timeline">${tl.days.map((d) => readDay(d, me)).join("")}</div>
        <div class="detail__side">
          <div id="jar-slot"></div>
          ${checklistPanel(t)}
        </div>
      </div>
    </section>`;

  renderJar(root.querySelector("#jar-slot"), t.id);
  wireDetail(root, id, me);
}

function readDay(day, me) {
  return `
    <div class="day day--read">
      <div class="day-head">
        <span class="day-head__n">Day ${day.index + 1}</span>
        ${day.date ? `<span class="day-head__date">${fmtDate(day.date)}</span>` : ""}
        <span class="day-head__drive">${day.driveMeters ? `🚗 ${fmtMiles(day.driveMeters)} · ${fmtDuration(day.driveSeconds)}` : ""}</span>
      </div>
      <ol class="events">${day.items.map((pt) => readItem(pt, me)).join("")}</ol>
    </div>`;
}

function readItem(pt, me) {
  if (pt.kind !== "stop") {
    const icon = ENDPOINT_ICONS[pt.kind] || "•";
    const tag = pt.kind === "origin" ? "Depart" : pt.kind === "return" ? "Return" : pt.kind === "apex" ? "Turnaround" : "Arrive";
    const role = pt.kind === "origin" || pt.kind === "return" ? "origin" : pt.kind === "apex" ? "apex" : "destination";
    return `<li class="ev ev--end ev--${role}"><span class="ev__pin">${icon}</span>
      <div class="ev__main"><div class="ev__top">
        <span class="ev__name">${escapeHtml(pt.place?.label || "—")}</span>
        <span class="ev__tag">${tag}</span><span class="ev__eta">${fmtTime(pt.etaMin)}</span>
      </div></div></li>`;
  }
  const s = pt.stop;

  // Surprise stop you didn't add: mystery placeholder
  if (!canSeeStop(s, me)) {
    return `<li class="ev ev--surprise"><span class="ev__pin">🎁</span>
      <div class="ev__main"><div class="ev__top">
        <span class="ev__name">Surprise stop</span><span class="ev__eta">${fmtTime(pt.etaMin)}</span>
      </div><p class="ev__line">🎁 A surprise from ${escapeHtml(s.addedBy || "someone")}</p></div></li>`;
  }

  const def = catDef(s.category);
  const tags = (s.tags || []).map((x) => `<span class="pill pill--read is-on">${escapeHtml(x)}</span>`).join("");
  const rx = REACTIONS.map((e) => {
    const who = s.reactions?.[e] || [];
    return `<button class="rx ${who.includes(me) ? "is-on" : ""}" data-react="${s.id}" data-emoji="${e}" title="${who.join(", ")}">${e}${who.length ? `<span>${who.length}</span>` : ""}</button>`;
  }).join("");
  const comments = (s.comments || []).map((c) => `<div class="cmt"><b>${escapeHtml(c.by)}</b> ${escapeHtml(c.text)}</div>`).join("");

  return `
    <li class="ev ev--${s.category || "sight"}${s.surprise ? " ev--mine-surprise" : ""}">
      <span class="ev__pin">${s.surprise ? "🎁" : def.icon}</span>
      <div class="ev__main">
        <div class="ev__top">
          <span class="ev__name">${escapeHtml(s.label)}</span>
          ${s.addedBy ? `<span class="ev__by">· ${escapeHtml(s.addedBy)}</span>` : ""}
          <span class="ev__eta">${fmtTime(pt.etaMin)}</span>
        </div>
        ${tags ? `<div class="ev__tags">${tags}</div>` : ""}
        ${s.cost != null ? `<p class="ev__cost mono">$${s.cost}</p>` : ""}
        ${s.confirmation ? `<p class="ev__line">📋 ${escapeHtml(s.confirmation)}</p>` : ""}
        ${s.phone ? `<p class="ev__line">📞 ${escapeHtml(s.phone)}</p>` : ""}
        ${s.notes ? `<p class="ev__noteline">${escapeHtml(s.notes)}</p>` : ""}
        ${s.photoUrl ? `<img class="ev__photo" src="${s.photoUrl}" alt="" loading="lazy">` : ""}
        <div class="ev__rx">${rx}</div>
        ${comments ? `<div class="ev__cmts">${comments}</div>` : ""}
        <div class="cmt-add">
          <input class="cmt-in" data-cin="${s.id}" placeholder="Add a comment…">
          <button class="link" data-cpost="${s.id}">Post</button>
        </div>
      </div>
    </li>`;
}

function checklistPanel(t) {
  const items = t.checklist || [];
  const done = items.filter((i) => i.done).length;
  return `
    <aside class="jar checklist">
      <div class="jar__head"><h2>Checklist</h2><span class="mono">${done}/${items.length}</span></div>
      <ul class="chk">
        ${items.map((i) => `
          <li class="chk__i ${i.done ? "is-done" : ""}">
            <label><input type="checkbox" data-check="${i.id}" ${i.done ? "checked" : ""}> <span>${escapeHtml(i.text)}</span></label>
            <button class="icon" data-check-rm="${i.id}" aria-label="Remove">✕</button>
          </li>`).join("") || `<li class="chk__empty">Nothing yet — add the first thing.</li>`}
      </ul>
      <div class="jar__deposit">
        <input class="input" id="chk-new" placeholder="Book hotel, bring cooler…">
        <button class="btn btn--solid" id="chk-add">Add</button>
      </div>
    </aside>`;
}

function wireDetail(root, id, me) {
  root.querySelector("[data-dup]")?.addEventListener("click", () => {
    const copy = store.duplicateTrip(id); if (copy) location.hash = `#/plan/${copy.id}`;
  });
  root.querySelector("[data-del]")?.addEventListener("click", () => {
    if (confirm("Delete this trip for the whole Gathering?")) { store.deleteTrip(id); location.hash = "#/"; }
  });
  root.querySelectorAll("[data-react]").forEach((b) => b.onclick = () => {
    store.reactToStop(id, b.dataset.react, b.dataset.emoji, me); renderTrip(root, id);
  });
  root.querySelectorAll("[data-cpost]").forEach((b) => b.onclick = () => {
    const inp = root.querySelector(`[data-cin="${b.dataset.cpost}"]`);
    const v = inp?.value.trim(); if (v) { store.commentOnStop(id, b.dataset.cpost, me, v); renderTrip(root, id); }
  });
  const add = root.querySelector("#chk-add");
  if (add) add.onclick = () => {
    const v = root.querySelector("#chk-new").value.trim();
    if (v) { store.addChecklistItem(id, v, me); renderTrip(root, id); }
  };
  root.querySelectorAll("[data-check]").forEach((cb) => cb.onchange = () => { store.toggleChecklistItem(id, cb.dataset.check); renderTrip(root, id); });
  root.querySelectorAll("[data-check-rm]").forEach((b) => b.onclick = () => { store.removeChecklistItem(id, b.dataset.checkRm); renderTrip(root, id); });
}

function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
