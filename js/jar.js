// ─────────────────────────────────────────────────────────────
//  Jar — the small shared savings side of a trip.
// ─────────────────────────────────────────────────────────────

import * as store from "./store.js";
import { money } from "./util.js";

export function renderJar(slot, tripId) {
  const t = store.getTrip(tripId);
  const { me } = store.getSession();
  const totals = store.jarTotals(t);
  const pct = totals.goal ? Math.min(100, Math.round((totals.saved / totals.goal) * 100)) : 0;

  slot.innerHTML = `
    <aside class="jar">
      <div class="jar__head">
        <h2>Trip jar</h2>
        <button class="link" data-edit-goal>${totals.goal ? "Edit goal" : "Set a goal"}</button>
      </div>

      <div class="jar__meter">
        <div class="jar__nums">
          <span class="mono jar__saved">${money(totals.saved)}</span>
          <span class="jar__of">of ${money(totals.goal)}</span>
        </div>
        <div class="jar__bar"><span style="width:${pct}%"></span></div>
        <p class="jar__remain">${totals.goal ? `${money(totals.remaining)} to go` : "No goal set yet"}</p>
      </div>

      <div class="jar__deposit">
        <input class="input" id="dep-amount" inputmode="decimal" placeholder="Amount">
        <button class="btn btn--solid" id="dep-go">Deposit</button>
      </div>
      <p class="jar__as">Depositing as <strong>${escapeHtml(me || "you")}</strong></p>

      ${Object.keys(totals.byMember).length ? `
        <ul class="jar__members">
          ${Object.entries(totals.byMember).sort((a, b) => b[1] - a[1]).map(([m, amt]) => `
            <li><span>${escapeHtml(m)}</span><span class="mono">${money(amt)}</span></li>`).join("")}
        </ul>` : ""}
    </aside>`;

  slot.querySelector("#dep-go").onclick = () => {
    const amt = Number(slot.querySelector("#dep-amount").value);
    if (!amt || amt <= 0) return;
    store.deposit(tripId, me || "you", amt);
    renderJar(slot, tripId);
  };

  slot.querySelector("[data-edit-goal]").onclick = () => {
    const g = prompt("Savings goal for this trip ($):", t.jar?.goal || "");
    if (g === null) return;
    store.setGoal(tripId, g);
    renderJar(slot, tripId);
  };
}

function escapeHtml(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
