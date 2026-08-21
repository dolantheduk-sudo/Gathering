// ─────────────────────────────────────────────────────────────
//  Maps provider — Google implementation
//
//  This is the SEAM. Everything Google-specific lives here, behind a
//  small interface: loadMaps, createMap, createAutocomplete, computeRoute,
//  drawRoute, photoUrlFor. To move to Mapbox/MapLibre later, write a
//  maps-mapbox.js that exports the same functions — nothing else changes.
//
//  NOTE ON COST/PRODUCTION: this prototype calls Google directly from the
//  browser using the client-side JS SDK (DirectionsService, Places
//  Autocomplete). That is fine for a hobby-scale Gathering and stays inside
//  Google's per-SKU monthly free tiers. For scale, move computeRoute() and
//  photo lookups to a Supabase Edge Function that calls the Routes API +
//  Places API (New) with a secret key and CACHES results. See README.
// ─────────────────────────────────────────────────────────────

let _loaded = null;

// Boot Google's JS SDK once, using the key from config.
export function loadMaps(apiKey) {
  if (_loaded) return _loaded;
  if (!apiKey) return Promise.reject(new Error("NO_KEY"));

  _loaded = new Promise((resolve, reject) => {
    // Google's official inline bootstrap loader (async).
    ((g) => {
      let h, a, k, p = "The Google Maps JavaScript API",
        c = "google", l = "importLibrary", q = "__ib__",
        m = document, b = window;
      b = b[c] || (b[c] = {});
      const d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
        u = () => h || (h = new Promise(async (res, rej) => {
          a = m.createElement("script");
          e.set("libraries", [...r] + "");
          for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = res;
          a.onerror = () => (h = rej(Error(p + " could not load.")));
          a.nonce = m.querySelector("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
      d[l] ? console.warn(p + " only loads once. Ignoring:", g)
           : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
    })({ key: apiKey, v: "weekly" });

    Promise.all([
      google.maps.importLibrary("maps"),      // Map, Polyline, Marker
      google.maps.importLibrary("places"),    // Autocomplete, photos
      google.maps.importLibrary("geocoding"), // reverse-geocode map clicks
      google.maps.importLibrary("routes"),    // Route.computeRoutes
    ]).then(resolve).catch(reject);
  });
  return _loaded;
}

export function createMap(el, center, zoom) {
  return new google.maps.Map(el, {
    center, zoom,
    disableDefaultUI: true,
    zoomControl: true,
    fullscreenControl: true,
    gestureHandling: "greedy",   // wheel-zoom directly when hovering the map
    clickableIcons: false,
    styles: MAP_STYLE,
  });
}

// Refit the map to a set of points (for a "recenter" button).
export function fitPoints(map, points) {
  if (!points?.length) return;
  const b = new google.maps.LatLngBounds();
  points.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
  map.fitBounds(b, 64);
}

// Create a Place Autocomplete widget inside a container element, and call
// onPick with a normalized point when the user selects a place.
//
// NOTE: the classic google.maps.places.Autocomplete widget was cut off for
// projects created after March 1, 2025, so we use the new web component,
// PlaceAutocompleteElement (runs on Places API New). It renders its own input,
// so we drop it into a container rather than attaching to an <input>.
export function createAutocomplete(container, onPick) {
  const el = new google.maps.places.PlaceAutocompleteElement();
  el.style.width = "100%";
  container.replaceChildren(el);

  el.addEventListener("gmp-select", async (event) => {
    try {
      const place = event.placePrediction.toPlace();
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "photos"] });
      onPick(normalizePlace(place));
    } catch (err) {
      console.error("Place selection failed:", err);
    }
  });
  return el;
}

// Reverse-geocode a map click into a point (for "set point on map").
export async function pointFromClick(latLng) {
  const geocoder = new google.maps.Geocoder();
  try {
    const { results } = await geocoder.geocode({ location: latLng });
    const best = results?.[0];
    return {
      label: best?.formatted_address || `${latLng.lat().toFixed(4)}, ${latLng.lng().toFixed(4)}`,
      lat: latLng.lat(), lng: latLng.lng(),
      placeId: best?.place_id || null, photoUrl: null,
    };
  } catch {
    return { label: `${latLng.lat().toFixed(4)}, ${latLng.lng().toFixed(4)}`, lat: latLng.lat(), lng: latLng.lng(), placeId: null, photoUrl: null };
  }
}

function normalizePlace(place) {
  const loc = place.location;
  const lat = typeof loc?.lat === "function" ? loc.lat() : loc?.lat;
  const lng = typeof loc?.lng === "function" ? loc.lng() : loc?.lng;
  let photoUrl = null;
  try { photoUrl = place.photos?.[0]?.getURI?.({ maxWidth: 400, maxHeight: 300 }) || null; } catch { photoUrl = null; }
  return {
    label: place.displayName || place.formattedAddress || "Unnamed stop",
    lat, lng,
    placeId: place.id || null,
    photoUrl,
  };
}

// Compute a route across origin → waypoints → destination.
// Returns { distanceMeters, durationSeconds, path: [{lat,lng}, ...] }.
// For a LOOP, pass destination === origin and put every stop (incl. the
// turnaround) in waypoints.
//
// Uses the new Routes API (Route.computeRoutes) — the legacy
// DirectionsService is blocked for projects created after Feb 2026.
export async function computeRoute({ origin, destination, waypoints = [] }) {
  const { Route } = await google.maps.importLibrary("routes");
  const wp = (p) => ({ location: { lat: p.lat, lng: p.lng } });

  const result = await Route.computeRoutes({
    origin: wp(origin),
    destination: wp(destination),
    intermediates: waypoints.map(wp),
    travelMode: "DRIVING",
    fields: ["path", "distanceMeters", "durationMillis", "legs"],
  });

  const route = result.routes?.[0];
  if (!route) throw new Error("NO_ROUTE");

  const path = (route.path || []).map((p) => ({
    lat: typeof p.lat === "function" ? p.lat() : p.lat,
    lng: typeof p.lng === "function" ? p.lng() : p.lng,
  }));

  // Per-leg distance/time drives ETAs and per-day subtotals in the planner.
  const legs = (route.legs || []).map((l) => ({
    distanceMeters: l.distanceMeters || 0,
    durationSeconds: Math.round((l.durationMillis || 0) / 1000),
  }));

  // Per-leg geometry (if the SDK exposes it) lets us ghost the return leg
  // and add arrows per segment. Falls back to the whole-route path.
  const toXY = (p) => ({ lat: typeof p.lat === "function" ? p.lat() : p.lat, lng: typeof p.lng === "function" ? p.lng() : p.lng });
  const legPathsRaw = (route.legs || []).map((l) => (l.path || []).map(toXY));
  const legPaths = legPathsRaw.length && legPathsRaw.every((lp) => lp.length) ? legPathsRaw : null;

  return {
    distanceMeters: route.distanceMeters || 0,
    durationSeconds: Math.round((route.durationMillis || 0) / 1000),
    path,
    legs,
    legPaths,
  };
}

// Category → pin fill color (matches the timeline), 1920s-hotel palette.
const CAT_COLOR = {
  sight: "#1F6B4F", food: "#B5652F", sleep: "#35617F",
  fun: "#7B4F8C", gas: "#C9A227", shop: "#4A8C6A",
};

let _infoWin = null;

// Draw the route + pins. Returns a cleanup handle.
//  segments: [{ path:[{lat,lng}], ghost:bool }] — solid vs faded "way home"
//  opts.onPointClick(point) / opts.onPointDrag(point, latLng)
export function drawRoute(map, { segments, path, points }, opts = {}) {
  const overlays = [];
  const arrow = { icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#5c4a1e", strokeWeight: 1, fillColor: "#5c4a1e", fillOpacity: 1 }, offset: "10%", repeat: "150px" };
  const ghostArrow = { icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.2, strokeColor: "#9c7b2e", strokeWeight: 1, fillColor: "#9c7b2e", fillOpacity: 0.7 }, offset: "22%", repeat: "170px" };

  const addLine = (pts, ghost) => {
    if (!pts?.length) return;
    // The drive home often reuses the outbound road; nudge it sideways so it
    // reads as a separate faded lane instead of hiding under the solid line.
    const drawn = ghost ? offsetPath(pts, 0.0045) : pts;
    overlays.push(new google.maps.Polyline({
      path: drawn, geodesic: true,
      strokeColor: ghost ? "#9c7b2e" : "#C9A227",
      strokeOpacity: ghost ? 0.5 : 0.95,
      strokeWeight: ghost ? 3 : 5,
      icons: [ghost ? ghostArrow : arrow],
      map, zIndex: ghost ? 1 : 2,
    }));
  };
  const segs = segments || (path ? [{ path, ghost: false }] : []);
  segs.forEach((s) => addLine(s.path, s.ghost));

  if (!_infoWin) _infoWin = new google.maps.InfoWindow();

  (points || []).forEach((pt) => {
    const hidden = !!pt.hidden;   // surprise stop the viewer can't see
    const marker = new google.maps.Marker({
      position: { lat: pt.lat, lng: pt.lng },
      map,
      draggable: !!opts.onPointDrag && !hidden,
      label: (pt.role === "stop" && !hidden) ? { text: String(pt.index), color: "#fff", fontFamily: "Space Mono, monospace", fontSize: "11px", fontWeight: "700" } : null,
      icon: pinIcon(pt),
      title: hidden ? "Surprise" : pt.label,
      zIndex: 5,
    });
    if (!hidden) {   // surprise pins are inert — clicking must not reveal them
      marker.addListener("click", () => {
        _infoWin.setContent(`<div style="font:600 13px/1.3 'DM Sans',sans-serif;color:#26231c">${escapeAttr(pt.label)}${pt.eta ? `<br><span style="font-family:'Space Mono',monospace;color:#14503a">${pt.eta}</span>` : ""}</div>`);
        _infoWin.open(map, marker);
        opts.onPointClick?.(pt);
      });
      if (opts.onPointDrag) marker.addListener("dragend", (e) => opts.onPointDrag(pt, e.latLng));
    }
    overlays.push(marker);
  });

  fitPoints(map, points);
  return () => overlays.forEach((o) => o.setMap(null));
}

function pinIcon(pt) {
  const kind = pt.role;
  if (pt.hidden) return { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: "#7b4f8c", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2.5 };
  const fill = kind === "origin" ? "#1F6B4F"
    : kind === "destination" ? "#14503A"
    : kind === "apex" ? "#B5652F"
    : CAT_COLOR[pt.category] || "#1F6B4F";
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: kind === "stop" ? 11 : 13,
    fillColor: fill, fillOpacity: 1,
    strokeColor: "#f6efdc", strokeWeight: 2.5,
  };
}

function escapeAttr(s = "") { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Shift a lat/lng path sideways by ~d degrees, perpendicular to its direction,
// so an out-and-back's return lane runs beside the outbound instead of on it.
function offsetPath(path, d) {
  if (path.length < 2) return path;
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
    const len = Math.hypot(dLat, dLng) || 1;
    // perpendicular to tangent (dLng, dLat) is (-dLat, dLng)
    return { lat: p.lat + (dLng / len) * d, lng: p.lng + (-dLat / len) * d };
  });
}

// Warm parchment map style so the gold route reads like ink on old paper.
const MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#efe7d0" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a7c5f" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#efe7d0" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#e2d8bd" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d8caa6" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bcccb4" }] },
];
