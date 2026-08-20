-- ─────────────────────────────────────────────────────────────
--  Gathering — Supabase schema (the multiplayer backbone)
--  Run this in the Supabase SQL editor when you're ready to go
--  from "local" to shared/real-time. Then flip config.BACKEND.
-- ─────────────────────────────────────────────────────────────

-- Gatherings (groups) ------------------------------------------
create table gatherings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz default now()
);

-- Membership: which auth users belong to which gathering --------
create table memberships (
  gathering_id uuid references gatherings(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at    timestamptz default now(),
  primary key (gathering_id, user_id)
);

-- Trips --------------------------------------------------------
create table trips (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references gatherings(id) on delete cascade,
  name          text not null default '',
  type          text not null default 'line' check (type in ('line','loop')),
  origin        jsonb,           -- { label, lat, lng, placeId, photoUrl }
  destination   jsonb,           -- for a loop, this is the turnaround (apex)
  distance_m    integer,
  duration_s    integer,
  jar_goal      numeric default 0,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Stops (ordered waypoints between the ends) -------------------
create table stops (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  position   integer not null,        -- drives the order in the list
  label      text not null,
  lat        double precision,
  lng        double precision,
  place_id   text,
  photo_url  text,
  notes      text default ''
);
create index on stops (trip_id, position);

-- Jar contributions --------------------------------------------
create table contributions (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  user_id    uuid references auth.users(id),
  member     text not null,
  amount     numeric not null check (amount > 0),
  created_at timestamptz default now()
);

-- ── Row Level Security: everything scoped to your gathering ───
alter table gatherings    enable row level security;
alter table memberships   enable row level security;
alter table trips         enable row level security;
alter table stops         enable row level security;
alter table contributions enable row level security;

-- helper: is the current user a member of this gathering?
create or replace function is_member(g uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from memberships m where m.gathering_id = g and m.user_id = auth.uid());
$$;

create policy "members read gathering" on gatherings
  for select using (is_member(id));

create policy "members manage own membership" on memberships
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members read/write trips" on trips
  for all using (is_member(gathering_id)) with check (is_member(gathering_id));

create policy "members read/write stops" on stops
  for all using (is_member((select gathering_id from trips t where t.id = trip_id)))
  with check (is_member((select gathering_id from trips t where t.id = trip_id)));

create policy "members read/write contributions" on contributions
  for all using (is_member((select gathering_id from trips t where t.id = trip_id)))
  with check (is_member((select gathering_id from trips t where t.id = trip_id)));

-- ── Realtime: broadcast row changes so edits appear live ──────
alter publication supabase_realtime add table trips, stops, contributions;
-- In the client, subscribe with db.channel(...).on('postgres_changes', ...).
-- Use Realtime *Presence* on a per-trip channel to show who's editing.

-- ── keep updated_at fresh ─────────────────────────────────────
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger trips_touch before update on trips
  for each row execute function touch_updated_at();

-- ── Notifications ────────────────────────────────────────────
-- Create a Database Webhook (Dashboard → Database → Webhooks) on
--   INSERT of `trips`         → "A new trip was planned"
--   INSERT of `contributions` → "Someone added to the jar"
-- pointed at an Edge Function that sends email/push. That Edge Function
-- is also the right place to proxy Google Routes/Places calls with a
-- secret key and cache the results (respecting Google's caching TOS).
