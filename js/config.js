// ─────────────────────────────────────────────────────────────
//  Gathering — configuration
//  This is the ONE file you edit to get the app running.
// ─────────────────────────────────────────────────────────────

export const config = {
  // 1) Google Maps Platform key.
  //    Get one at https://console.cloud.google.com/google/maps-apis
  //    Enable: "Maps JavaScript API" + "Places API (New)".
  //    Restrict the key by HTTP referrer to your GitHub Pages URL.
  //    Leave blank to run the app in "no-map setup" mode.
  GOOGLE_MAPS_API_KEY: "AIzaSyB3pM_8Y1PAMY7x-dsORK7XkPvsNmdDlp4",

  // 2) Where the map opens before a trip is loaded (Erie, PA by default).
  DEFAULT_CENTER: { lat: 42.1292, lng: -80.0851 },
  DEFAULT_ZOOM: 6,

  // 3) Backend mode.
  //    "local"    → everything saved in this browser (localStorage). Works today, no setup.
  //    "supabase" → shared across your Gathering in real time. See supabase/schema.sql
  //                 and README before switching this on.
  BACKEND: "local",

  // 4) Supabase (only used when BACKEND === "supabase").
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // 5) Units.
  UNITS: "imperial", // "imperial" (miles) or "metric" (km)
};
