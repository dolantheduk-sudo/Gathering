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
