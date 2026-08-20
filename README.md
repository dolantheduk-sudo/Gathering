# Gathering

A collaborative road-trip planner for a crew. Plan a **line** (A→B) or a **loop**
(out & back), drop stops with search-as-you-type, watch miles and drive time update
live, and chip into a shared **trip jar**. Same shape as Budget Nugget: static front
end + Supabase, deployable on GitHub Pages.

## Run it in 30 seconds (no keys, no backend)

```bash
cd gathering
python3 -m http.server 8000   # or: npx serve .
```

Open http://localhost:8000. Name your Gathering, add yourself, and start planning.
Everything saves to your browser. The **map and place search stay dark until you add
a Google key** — every other feature (stops, notes, reordering, the jar) works now.

## Turn on the map

1. Google Cloud Console → enable **Maps JavaScript API** and **Places API (New)**.
2. Create an API key. Restrict it: *Application restrictions → HTTP referrers* → your
   GitHub Pages URL (and `http://localhost:8000/*` for local dev).
3. Paste it into `js/config.js` → `GOOGLE_MAPS_API_KEY`.

Cost note: Google retired the old flat $200 credit in March 2025. You're now on
**per-SKU monthly free tiers** (~10k Maps loads, ~5k Pro calls). A few friends
planning trips stays comfortably inside that — effectively free. But a billing
account with a card is required, so **set a quota cap** in the console to be safe.

## Go multiplayer (shared + live)

Right now `config.BACKEND` is `"local"`. To share across the Gathering in real time:

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor (tables, row-level security scoped to
   your Gathering, realtime publication, notification hooks).
3. Fill `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/config.js`, set `BACKEND: "supabase"`.
4. Implement the Supabase adapter — the stubs are already sketched at the bottom of
   `js/store.js`. Because every screen talks only to `store.js`, no screen code changes.

Realtime **Presence** (on a per-trip channel) is how you'd show *who's editing a trip*.
Database **Webhooks** on `trips`/`contributions` inserts → an Edge Function → email/push
give you "a new trip was planned" and "someone added to the jar" notifications. That
same Edge Function is the right home for proxying Google Routes/Places calls with a
secret key and caching results (respecting Google's caching terms) once usage grows.

## How it's wired (the two seams that keep it modular)

- **`js/providers/maps-google.js`** — all Google code behind `loadMaps / createMap /
  attachSearch / computeRoute / drawRoute`. Swap in `maps-mapbox.js` with the same
  exports and nothing else changes.
- **`js/store.js`** — all persistence behind `listTrips / saveTrip / deposit / …`.
  Local today, Supabase tomorrow, same interface.

Everything else is a feature module: `planner.js`, `home.js`, `jar.js`. Add a feature
by adding a module, not by surgery on a monolith.

## Files

```
index.html            app shell
css/app.css           design system + the signature route-line itinerary
js/config.js          ← the one file you edit
js/app.js             onboarding + hash router
js/planner.js         build/edit a trip (the core loop)
js/home.js            trip list + trip detail
js/jar.js             the shared savings jar
js/store.js           data layer (local now, Supabase-ready)
js/providers/maps-google.js   maps provider seam
js/util.js            formatting helpers
supabase/schema.sql   the multiplayer backbone
```
