-- ─────────────────────────────────────────────────────────────
--  Migration: member profiles (emoji avatar + editable name)
--  SAFE to run on your existing project — it does NOT drop anything.
--  Paste into the Supabase SQL editor and Run.
-- ─────────────────────────────────────────────────────────────

alter table memberships add column if not exists avatar text default '🧭';

-- Let a member update their own profile (name + avatar).
drop policy if exists mem_update on memberships;
create policy mem_update on memberships
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
