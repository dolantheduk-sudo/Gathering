-- ─────────────────────────────────────────────────────────────
--  Gathering — Supabase schema (shared multiplayer backend)
--  Run this whole file in the Supabase SQL editor, then set
--  config.BACKEND = "supabase". Safe to re-run (drops first).
-- ─────────────────────────────────────────────────────────────

drop table if exists contributions cascade;
drop table if exists trips cascade;
drop table if exists memberships cascade;
drop table if exists gatherings cascade;

-- Gatherings, each with a short human-typeable join code -------
create table gatherings (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text unique not null,
  created_at timestamptz default now()
);

-- Who belongs to which gathering ------------------------------
create table memberships (
  gathering_id uuid references gatherings(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at    timestamptz default now(),
  primary key (gathering_id, user_id)
);

-- Trips — the whole trip is one row (stops live as JSON). id is
-- TEXT so the client can generate it (matches local mode). -----
create table trips (
  id             text primary key,
  gathering_id   uuid not null references gatherings(id) on delete cascade,
  name           text not null default '',
  type           text not null default 'line',
  origin         jsonb,
  destination    jsonb,
  start_date     date,
  departure_time text default '08:00',
  day_start      text default '09:00',
  distance_m     integer,
  duration_s     integer,
  legs           jsonb default '[]'::jsonb,
  stops          jsonb default '[]'::jsonb,
  jar_goal       numeric default 0,
  created_by     uuid references auth.users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Jar contributions (separate so concurrent deposits don't clobber)
create table contributions (
  id         uuid primary key default gen_random_uuid(),
  trip_id    text not null references trips(id) on delete cascade,
  member     text not null,
  amount     numeric not null check (amount > 0),
  created_at timestamptz default now()
);

-- ── Row Level Security ───────────────────────────────────────
create or replace function is_member(g uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from memberships m where m.gathering_id = g and m.user_id = auth.uid());
$$;

alter table gatherings    enable row level security;
alter table memberships   enable row level security;
alter table trips         enable row level security;
alter table contributions enable row level security;

create policy gth_read   on gatherings   for select using (is_member(id));
create policy mem_read   on memberships  for select using (user_id = auth.uid() or is_member(gathering_id));
create policy mem_write  on memberships  for insert with check (user_id = auth.uid());
create policy trips_all  on trips        for all using (is_member(gathering_id)) with check (is_member(gathering_id));
create policy contrib_all on contributions for all
  using (is_member((select gathering_id from trips t where t.id = trip_id)))
  with check (is_member((select gathering_id from trips t where t.id = trip_id)));

-- ── Join-code helpers (security definer: safe, scoped lookups) ─
create or replace function gen_code() returns text
language sql as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random()*30)::int + 1, 1), '')
  from generate_series(1, 6);
$$;

create or replace function create_gathering(p_name text, p_display text)
returns table(id uuid, name text, join_code text)
language plpgsql security definer as $$
declare gid uuid; code text;
begin
  loop
    code := gen_code();
    exit when not exists (select 1 from gatherings g where g.join_code = code);
  end loop;
  insert into gatherings(name, join_code) values (p_name, code) returning gatherings.id into gid;
  insert into memberships(gathering_id, user_id, display_name) values (gid, auth.uid(), p_display);
  return query select g.id, g.name, g.join_code from gatherings g where g.id = gid;
end; $$;

create or replace function join_gathering(p_code text, p_display text)
returns table(id uuid, name text, join_code text)
language plpgsql security definer as $$
declare gid uuid;
begin
  select g.id into gid from gatherings g where g.join_code = upper(trim(p_code));
  if gid is null then raise exception 'INVALID_CODE'; end if;
  insert into memberships(gathering_id, user_id, display_name)
    values (gid, auth.uid(), p_display)
    on conflict (gathering_id, user_id) do update set display_name = excluded.display_name;
  return query select g.id, g.name, g.join_code from gatherings g where g.id = gid;
end; $$;

grant execute on function create_gathering(text, text) to authenticated;
grant execute on function join_gathering(text, text) to authenticated;

-- ── Realtime + updated_at ────────────────────────────────────
alter publication supabase_realtime add table trips, contributions;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger trips_touch before update on trips
  for each row execute function touch_updated_at();
