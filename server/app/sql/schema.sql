-- TwinMind session store schema — v1.
-- Authoritative source: decision-008-supabase-session-store.md.
-- Apply against a fresh Supabase project (or any Postgres) before running
-- the backend:
--     psql -f app/sql/schema.sql "$DATABASE_URL"

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_touched timestamptz not null default now()
);

create table if not exists transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  text text not null,
  started_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists transcript_segments_session_received_idx
  on transcript_segments (session_id, received_at);

create table if not exists suggestion_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  transcript_window_chars int not null,
  transcript_window_used text not null,
  prompt_used text not null,
  prompt_version text not null
);
create index if not exists suggestion_batches_session_created_idx
  on suggestion_batches (session_id, created_at desc);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references suggestion_batches(id) on delete cascade,
  type text not null check (type in
    ('question','talking_point','answer','fact_check','clarifying_info')),
  preview text not null,
  rationale text
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  triggered_by_suggestion_id uuid references suggestions(id) on delete set null,
  finished boolean not null default true
);
create index if not exists chat_messages_session_created_idx
  on chat_messages (session_id, created_at);
