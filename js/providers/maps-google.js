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
    clickableIcons: false,
    styles: MAP_STYLE,
  });
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
    fields: ["path", "distanceMeters", "durationMillis"],
  });

  const route = result.routes?.[0];
  if (!route) throw new Error("NO_ROUTE");

  const path = (route.path || []).map((p) => ({
    lat: typeof p.lat === "function" ? p.lat() : p.lat,
    lng: typeof p.lng === "function" ? p.lng() : p.lng,
  }));

  return {
    distanceMeters: route.distanceMeters || 0,
    durationSeconds: Math.round((route.durationMillis || 0) / 1000),
    path,
  };
}

// Draw the amber dashed "route" polyline + pins. Returns a cleanup handle.
export function drawRoute(map, { path, points }) {
  const overlays = [];

  if (path?.length) {
    const line = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeOpacity: 0,          // we only want the dashes
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#E4A03C", strokeWeight: 4, scale: 3 },
        offset: "0", repeat: "16px",
      }],
      map,
    });
    overlays.push(line);
  }

  (points || []).forEach((pt, i) => {
    const kind = pt.role; // "origin" | "stop" | "apex" | "destination"
    const marker = new google.maps.Marker({
      position: { lat: pt.lat, lng: pt.lng },
      map,
      label: kind === "stop" ? { text: String(pt.index), color: "#17211F", fontFamily: "Space Mono, monospace", fontSize: "12px", fontWeight: "700" } : null,
      icon: pinIcon(kind),
      title: pt.label,
    });
    overlays.push(marker);
  });

  if (points?.length) {
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 64);
  }

  return () => overlays.forEach((o) => o.setMap(null));
}

function pinIcon(kind) {
  const fill = kind === "origin" ? "#2E6E5B"
    : kind === "destination" ? "#1F4E40"
    : kind === "apex" ? "#B9542F"
    : "#EEF0EA";
  const stroke = kind === "stop" ? "#E4A03C" : "#17211F";
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: kind === "stop" ? 10 : 12,
    fillColor: fill, fillOpacity: 1,
    strokeColor: stroke, strokeWeight: 3,
  };
}

// Minimal, muted map style so our amber route is the loudest thing on screen.
const MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#eef0ea" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6e7b76" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#eef0ea" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#dfe3db" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#cfd6cd" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c3d3cc" }] },
];
