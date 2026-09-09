-- 00_test_parents.sql
-- Test-only stubs for parent tables that already exist in production.
-- Do not run this against live Supabase. The constraint tests apply it to
-- an empty local Postgres so 01_quote_followup.sql can add real FKs.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'quote_status') then
    create type quote_status as enum (
      'טיוטה',
      'נשלחה ללקוח',
      'נחתמה',
      'נדחתה',
      'פג תוקף',
      'בוטלה'
    );
  end if;
end $$;

create table if not exists app_users (
  id         uuid primary key default gen_random_uuid(),
  email      text        not null default 'test@example.com',
  full_name  text,
  is_active  boolean     not null default true,
  deleted_at timestamptz
);

create table if not exists customers (
  id               uuid primary key default gen_random_uuid(),
  customer_number  text not null,
  name             text not null,
  phone            text,
  deleted_at       timestamptz
);

create table if not exists leads (
  id           uuid primary key default gen_random_uuid(),
  lead_number  text not null,
  name         text not null,
  phone        text,
  deleted_at   timestamptz
);

create table if not exists quotes (
  id            uuid primary key default gen_random_uuid(),
  quote_number  text         not null,
  customer_id   uuid,
  lead_id       uuid,
  status        quote_status not null default 'טיוטה',
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  deleted_at    timestamptz
);

create table if not exists quote_versions (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid        not null,
  version_number  integer     not null,
  status          text        default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
