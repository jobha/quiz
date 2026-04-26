-- Quiz schema. Run this in the Supabase SQL editor for your project.
-- Idempotent enough to re-run during development.

create extension if not exists "pgcrypto";

-- Rooms ------------------------------------------------------------------
create table if not exists rooms (
  code               text primary key,                 -- short code, e.g. ABC123
  host_secret        uuid not null default gen_random_uuid(),
  host_rejoin_code   text,                             -- short shareable host code
  phase              text not null default 'lobby',    -- lobby | asking | revealed | ended
  current_question_id uuid,
  show_scoreboard    boolean not null default false,
  show_own_score     boolean not null default true,
  created_at         timestamptz not null default now()
);
alter table rooms add column if not exists host_rejoin_code text;
alter table rooms add column if not exists show_scoreboard boolean not null default false;
alter table rooms add column if not exists show_own_score boolean not null default true;

-- Questions --------------------------------------------------------------
create table if not exists questions (
  id              uuid primary key default gen_random_uuid(),
  room_code       text not null references rooms(code) on delete cascade,
  position        int  not null,
  type            text not null,                    -- 'text' | 'choice'
  prompt          text not null,
  choices         jsonb,                            -- array of strings, null for text
  correct_answer  text not null,                    -- canonical correct answer
  points          double precision not null default 1, -- fractional allowed
  image_url       text,                             -- optional uploaded image
  created_at      timestamptz not null default now()
);
alter table questions add column if not exists image_url text;
create index if not exists questions_room_position_idx
  on questions(room_code, position);

-- Players ---------------------------------------------------------------
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  room_code       text not null references rooms(code) on delete cascade,
  name            text not null,
  rejoin_code     text,                            -- short shareable code, unique within room
  created_at      timestamptz not null default now()
);
alter table players add column if not exists rejoin_code text;
create index if not exists players_room_idx on players(room_code);
-- Rejoin codes are globally unique so a player can rejoin without
-- knowing the room code.
drop index if exists players_room_rejoin_idx;
create unique index if not exists players_rejoin_code_idx
  on players(rejoin_code) where rejoin_code is not null;
create unique index if not exists rooms_host_rejoin_idx
  on rooms(host_rejoin_code) where host_rejoin_code is not null;

-- Answers ---------------------------------------------------------------
create table if not exists answers (
  id              uuid primary key default gen_random_uuid(),
  room_code       text not null references rooms(code) on delete cascade,
  question_id     uuid not null references questions(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  answer          text not null,
  is_correct      boolean,                          -- legacy, derived from points_awarded
  points_awarded  double precision,                 -- null = not yet judged, 0 = wrong, fractional allowed
  submitted_at    timestamptz not null default now(),
  unique (question_id, player_id)
);
alter table answers add column if not exists points_awarded double precision;
create index if not exists answers_question_idx on answers(question_id);

-- RLS --------------------------------------------------------------------
-- Reads are public (knowing the room code is the access control). Writes
-- always go through the Next.js API routes using the service role key, so
-- we block all client writes via RLS.

alter table rooms     enable row level security;
alter table questions enable row level security;
alter table players   enable row level security;
alter table answers   enable row level security;

drop policy if exists "rooms_read"     on rooms;
drop policy if exists "questions_read" on questions;
drop policy if exists "players_read"   on players;
drop policy if exists "answers_read"   on answers;

-- Hide host_secret from anon: use a view (simpler) — for MVP we just
-- expose the column but never return it in API responses; clients query
-- specific columns. RLS still allows full read because realtime needs it.
create policy "rooms_read"     on rooms     for select using (true);
create policy "questions_read" on questions for select using (true);
create policy "players_read"   on players   for select using (true);
create policy "answers_read"   on answers   for select using (true);

-- No insert/update/delete policies => denied for anon. Service role
-- bypasses RLS, which is what the API routes use.

-- Realtime ---------------------------------------------------------------
-- Make changes broadcast to subscribed clients.
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table questions;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table answers;

-- REPLICA IDENTITY FULL means DELETE events include every column on the
-- old row — without this, postgres_changes filters like "room_code=eq.X"
-- can't see the room_code on DELETEs and silently drop them.
alter table rooms     replica identity full;
alter table questions replica identity full;
alter table players   replica identity full;
alter table answers   replica identity full;
