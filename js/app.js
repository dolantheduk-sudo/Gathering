// ─────────────────────────────────────────────────────────────
//  App — async boot, auth + join flow, router. Thin; features live
//  in modules. Works in both "local" and "supabase" backends.
// ─────────────────────────────────────────────────────────────

import { config } from "./config.js";
import * as store from "./store.js";
import { renderHome, renderTrip } from "./home.js";
import { openPlanner } from "./planner.js";

const view = document.querySelector("#view");
const chrome = document.querySelector("#chrome");
const isSupa = () => config.BACKEND === "supabase";

async function boot() {
  let sess;
  try { sess = await store.initSession(); }
  catch (e) { return fatal(e); }

  if (isSupa() && !sess.authed) return renderAuth();
  if (!sess.gathering) return isSupa() ? renderCreateJoin() : renderOnboarding();

  renderChrome();
  route();
  store.onData(rerender);
}

function rerender() {
  const h = location.hash || "#/";
  if (h === "#/" || h.startsWith("#/trip")) route();
}

// ── Supabase: sign in / sign up ──────────────────────────────
function renderAuth() {
  chrome.hidden = true;
  let mode = "in"; // "in" | "up"
  const draw = () => {
    view.innerHTML = `
      <section class="onboard">
        <div class="onboard__card">
          <span class="wordmark">Gathering</span>
          <h1>${mode === "in" ? "Welcome back." : "Create your account."}</h1>
          <p>Plan trips together — routes, stops, and a shared jar.</p>
          ${mode === "up" ? field("ob-name", "Your name", "text", "e.g. Jared") : ""}
          ${field("ob-email", "Email", "email", "you@example.com")}
          ${field("ob-pass", "Password", "password", "••••••••")}
          <button id="ob-go" class="btn btn--solid btn--wide">${mode === "in" ? "Sign in" : "Sign up"}</button>
          <p class="onboard__switch">${mode === "in"
            ? `New here? <button class="link" id="ob-switch">Create an account</button>`
            : `Have an account? <button class="link" id="ob-switch">Sign in</button>`}</p>
          <p id="ob-err" class="onboard__err"></p>
        </div>
      </section>`;
    view.querySelector("#ob-switch").onclick = () => { mode = mode === "in" ? "up" : "in"; draw(); };
    view.querySelector("#ob-go").onclick = submit;
  };
  const submit = async () => {
    const email = val("ob-email"), pass = val("ob-pass"), name = val("ob-name");
    const err = view.querySelector("#ob-err");
    err.textContent = "";
    if (!email || !pass || (mode === "up" && !name)) { err.textContent = "Fill in every field."; return; }
    try {
      if (mode === "up") {
        const data = await store.signUp(email, pass, name);
        if (!data.session) { err.textContent = "Account made — check your email to confirm, then sign in."; return; }
      } else {
        await store.signIn(email, pass);
      }
      boot();
    } catch (e) { err.textContent = friendly(e); }
  };
  draw();
}

// ── Supabase: create or join a Gathering ─────────────────────
function renderCreateJoin() {
  chrome.hidden = true;
  view.innerHTML = `
    <section class="onboard">
      <div class="onboard__card">
        <span class="wordmark">Gathering</span>
        <h1>Start or join.</h1>
        <div class="seg" style="margin:1rem 0">
          <button class="seg__btn is-on" data-cj="create">Create one</button>
          <button class="seg__btn" data-cj="join">Join with a code</button>
        </div>
        ${field("cj-name", "Your name", "text", "e.g. Jared")}
        <div id="cj-create">${field("cj-gname", "Gathering name", "text", "e.g. The Usual Suspects")}</div>
        <div id="cj-join" hidden>${field("cj-code", "Join code", "text", "6-letter code")}</div>
        <button id="cj-go" class="btn btn--solid btn--wide">Continue</button>
        <p id="cj-err" class="onboard__err"></p>
      </div>
    </section>`;
  let mode = "create";
  view.querySelectorAll("[data-cj]").forEach((b) => b.onclick = () => {
    mode = b.dataset.cj;
    view.querySelectorAll("[data-cj]").forEach((x) => x.classList.toggle("is-on", x === b));
    view.querySelector("#cj-create").hidden = mode !== "create";
    view.querySelector("#cj-join").hidden = mode !== "join";
  });
  view.querySelector("#cj-go").onclick = async () => {
    const name = val("cj-name"), err = view.querySelector("#cj-err");
    err.textContent = "";
    if (!name) { err.textContent = "Add your name."; return; }
    try {
      if (mode === "create") {
        const g = val("cj-gname"); if (!g) { err.textContent = "Name your Gathering."; return; }
        await store.createGatheringAsync(g, name);
      } else {
        const code = val("cj-code"); if (!code) { err.textContent = "Enter a join code."; return; }
        await store.joinGatheringCodeAsync(code, name);
      }
      boot();
    } catch (e) { err.textContent = friendly(e); }
  };
}

// ── Local onboarding (unchanged) ─────────────────────────────
function renderOnboarding() {
  chrome.hidden = true;
  view.innerHTML = `
    <section class="onboard">
      <div class="onboard__card">
        <span class="wordmark">Gathering</span>
        <h1>Plan trips together.</h1>
        <p>One shared space for the crew — routes, stops, and a jar you all chip into.</p>
        ${field("ob-group", "Gathering name", "text", "e.g. The Usual Suspects")}
        ${field("ob-me", "Your name", "text", "e.g. Jared")}
        <button id="ob-go" class="btn btn--solid btn--wide">Start planning</button>
      </div>
    </section>`;
  view.querySelector("#ob-go").onclick = () => {
    const g = val("ob-group"), m = val("ob-me");
    if (!g || !m) return;
    store.joinGathering(g, m);
    boot();
  };
}

// ── Top chrome / tabs ────────────────────────────────────────
function renderChrome() {
  const { gathering, me, avatar } = store.getSession();
  chrome.hidden = false;
  chrome.innerHTML = `
    <div class="topbar">
      <a class="wordmark" href="#/">Gathering</a>
      <nav class="tabs">
        <a href="#/" data-tab="home">Trips</a>
        <a href="#/plan" data-tab="plan">Plan</a>
        <a href="#/crew" data-tab="crew">Crew</a>
      </nav>
      <div class="topbar__right">
        ${gathering?.joinCode ? `<span class="code-chip" title="Share this to invite people">Code <b>${gathering.joinCode}</b></span>` : ""}
        <a class="me-chip" href="#/crew"><span class="me-chip__av">${avatar || "🧭"}</span> ${escapeHtml(me || "")}</a>
        ${isSupa() ? `<button class="link" id="signout">Sign out</button>` : ""}
      </div>
    </div>`;
  const so = chrome.querySelector("#signout");
  if (so) so.onclick = async () => { await store.signOut(); location.hash = "#/"; boot(); };
}

function markTab(name) {
  chrome.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("is-active", a.dataset.tab === name));
}

// ── Router ───────────────────────────────────────────────────
function route() {
  const h = location.hash || "#/";
  const [, seg, arg] = h.split("/");
  if (!seg) { markTab("home"); return renderHome(view); }
  if (seg === "plan") { markTab("plan"); return openPlanner(view, arg || null); }
  if (seg === "crew") { markTab("crew"); return renderCrew(view); }
  if (seg === "trip" && arg) { markTab("home"); return renderTrip(view, arg); }
  markTab("home"); renderHome(view);
}

const AVATARS = ["🧭","🎒","🚗","🗺️","⛰️","🏕️","🏖️","🌲","🦊","🐻","🦉","🌵","🍕","🎸","📷","⚓","🎩","🌙","☀️","🍄","🐢","🦅","🎯","🧳"];

async function renderCrew(view) {
  const { gathering, me, avatar } = store.getSession();
  view.innerHTML = `
    <section class="crew">
      <p class="eyebrow">${escapeHtml(gathering?.name || "Your Gathering")}</p>
      <h1 class="home__title">Crew</h1>

      <div class="crew__cols">
        <div class="crew__card">
          <h2>Your profile</h2>
          <div class="prof-av" id="prof-av">${avatar || "🧭"}</div>
          <div class="av-grid">
            ${AVATARS.map((e) => `<button class="av-opt ${e === avatar ? "is-on" : ""}" data-av="${e}">${e}</button>`).join("")}
          </div>
          <label class="field"><span class="field__label">Display name</span>
            <input id="prof-name" class="input" value="${escapeHtml(me || "")}"></label>
          <button id="prof-save" class="btn btn--solid">Save profile</button>
          <span id="prof-flash" class="flash"></span>
        </div>

        <div class="crew__card">
          <h2>Members</h2>
          ${gathering?.joinCode ? `<p class="crew__invite">Invite with code <b class="mono">${gathering.joinCode}</b></p>` : ""}
          <ul class="member-list" id="member-list"><li class="crew__loading">Loading…</li></ul>
        </div>
      </div>
    </section>`;

  let picked = avatar || "🧭";
  view.querySelectorAll("[data-av]").forEach((b) => b.onclick = () => {
    picked = b.dataset.av;
    view.querySelector("#prof-av").textContent = picked;
    view.querySelectorAll("[data-av]").forEach((x) => x.classList.toggle("is-on", x.dataset.av === picked));
  });
  view.querySelector("#prof-save").onclick = async () => {
    const name = view.querySelector("#prof-name").value.trim() || me;
    try {
      await store.updateProfileAsync(name, picked);
      const f = view.querySelector("#prof-flash"); f.textContent = "Saved!"; f.classList.add("show");
      renderChrome();
      loadMembers(view);
    } catch (e) { const f = view.querySelector("#prof-flash"); f.textContent = friendly(e); f.classList.add("show"); }
  };

  loadMembers(view);
}

async function loadMembers(view) {
  const ul = view.querySelector("#member-list");
  if (!ul) return;
  try {
    const members = await store.listMembersAsync();
    const { me } = store.getSession();
    ul.innerHTML = members.map((m) => `
      <li class="member">
        <span class="member__av">${m.avatar || "🧭"}</span>
        <span class="member__name">${escapeHtml(m.name)}${m.name === me ? ` <span class="member__you">you</span>` : ""}</span>
      </li>`).join("") || `<li class="crew__loading">No one yet.</li>`;
  } catch (e) {
    ul.innerHTML = `<li class="crew__loading">Couldn't load members — ${escapeHtml(friendly(e))}</li>`;
  }
}

// ── Helpers ──────────────────────────────────────────────────
function field(id, label, type, ph) {
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="${id}" class="input" type="${type}" placeholder="${ph}" autocomplete="off"></label>`;
}
const val = (id) => view.querySelector("#" + id)?.value.trim() || "";
function friendly(e) {
  const m = (e?.message || String(e));
  if (/INVALID_CODE/.test(m)) return "That join code didn't match a Gathering.";
  if (/Invalid login/i.test(m)) return "Wrong email or password.";
  if (/already registered/i.test(m)) return "That email already has an account — sign in instead.";
  return m;
}
function fatal(e) {
  chrome.hidden = true;
  view.innerHTML = `<section class="onboard"><div class="onboard__card">
    <h1>Couldn't start</h1><p class="onboard__err">${escapeHtml(e?.message || String(e))}</p>
    <p>If you just switched to Supabase, double-check the URL and key in config.js.</p></div></section>`;
}
function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

window.addEventListener("hashchange", route);
boot();
