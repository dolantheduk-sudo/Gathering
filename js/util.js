// Small shared helpers.
import { config } from "./config.js";

export function fmtMiles(meters) {
  if (config.UNITS === "metric") return `${Math.round(meters / 1000).toLocaleString()} km`;
  return `${Math.round(meters / 1609.34).toLocaleString()} mi`;
}

export function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

// ── Time helpers (minutes-since-midnight as the working unit) ──
export function parseTime(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

export function fmtTime(mins) {
  if (mins == null) return "";
  const wrapped = ((mins % 1440) + 1440) % 1440;   // clamp into one day
  let h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const ampm = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function toHHMM(mins) {
  if (mins == null) return "";
  const wrapped = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

// ── Date helpers (ISO "YYYY-MM-DD", treated as local calendar dates) ──
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function fmtDate(iso, withWeekday = true) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const opts = withWeekday
    ? { weekday: "short", month: "short", day: "numeric" }
    : { month: "short", day: "numeric" };
  return dt.toLocaleDateString(undefined, opts);
}

export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

export function countdownLabel(iso) {
  const n = daysUntil(iso);
  if (n == null) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1) return `in ${n} days`;
  if (n === -1) return "Yesterday";
  return `${Math.abs(n)} days ago`;
}
