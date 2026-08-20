// ─────────────────────────────────────────────────────────────
//  App — onboarding + router. Keep this thin; features live in modules.
// ─────────────────────────────────────────────────────────────

import * as store from "./store.js";
import { renderHome, renderTrip } from "./home.js";
import { openPlanner } from "./planner.js";

const view = document.querySelector("#view");
const chrome = document.querySelector("#chrome");

function boot() {
  const { gathering, me } = store.getSession();
  if (!gathering || !me) return renderOnboarding();
  renderChrome();
  route();
}

// ── Onboarding: name your Gathering, say who you are ─────────
function renderOnboarding() {
  chrome.hidden = true;
  view.innerHTML = `
    <section class="onboard">
      <div class="onboard__card">
        <span class="wordmark">Gathering</span>
        <h1>Plan trips together.</h1>
        <p>One shared space for the crew — routes, stops, and a jar you all chip into.</p>
        <label class="field"><span class="field__label">Gathering name</span>
          <input id="ob-group" class="input" placeholder="e.g. The Usual Suspects"></label>
        <label class="field"><span class="field__label">Your name</span>
          <input id="ob-me" class="input" placeholder="e.g. Jared"></label>
        <button id="ob-go" class="btn btn--solid btn--wide">Start planning</button>
      </div>
    </section>`;
  view.querySelector("#ob-go").onclick = () => {
    const g = view.querySelector("#ob-group").value.trim();
    const m = view.querySelector("#ob-me").value.trim();
    if (!g || !m) return;
    store.joinGathering(g, m);
    boot();
  };
}

// ── Top chrome / tabs ────────────────────────────────────────
function renderChrome() {
  const { gathering } = store.getSession();
  chrome.hidden = false;
  chrome.innerHTML = `
    <div class="topbar">
      <a class="wordmark" href="#/">Gathering</a>
      <nav class="tabs">
        <a href="#/" data-tab="home">Trips</a>
        <a href="#/plan" data-tab="plan">Plan</a>
      </nav>
      <span class="gname">${escapeHtml(gathering?.name || "")}</span>
    </div>`;
}

function markTab(name) {
  chrome.querySelectorAll("[data-tab]").forEach((a) =>
    a.classList.toggle("is-active", a.dataset.tab === name));
}

// ── Router (hash-based; GitHub Pages friendly) ───────────────
function route() {
  const h = location.hash || "#/";
  const [, seg, arg] = h.split("/"); // "#" , seg , arg

  if (!seg || seg === "") { markTab("home"); return renderHome(view); }
  if (seg === "plan") { markTab("plan"); return openPlanner(view, arg || null); }
  if (seg === "trip" && arg) { markTab("home"); return renderTrip(view, arg); }
  markTab("home"); renderHome(view);
}

window.addEventListener("hashchange", route);
store.onTripsChanged(() => { if ((location.hash || "#/") === "#/") renderHome(view); });
boot();

function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
