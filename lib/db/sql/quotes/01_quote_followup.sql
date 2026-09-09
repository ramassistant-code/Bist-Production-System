-- ============================================================================
-- 01_quote_followup.sql
-- BIS-10 — quote follow-up data model and duplicate prevention
-- https://linear.app/bistram/issue/BIS-10/1-מודל-נתונים-ומניעת-כפילויות
--
-- Architecture section 6. Does not alter enum quote_status.
-- Run in Supabase SQL Editor after confirming parent tables exist.
-- Idempotent: CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================================

begin;

-- ── Sequence states ─────────────────────────────────────────────────────────
-- Quota-holding: awaiting_delivered, active, paused.
-- Not quota-holding: stopped, completed, delivery_failed.

create table if not exists quote_followup_sequences (
  id                 uuid primary key default gen_random_uuid(),
  quote_id           uuid        not null references quotes(id) on delete restrict,
  quote_version_id   uuid        not null unique references quote_versions(id) on delete restrict,
  -- Internal quota key: E.164 with a leading plus (same idea as CRM toE164).
  -- Do not store the Whapi send field (digits or chat id, no plus) here.
  phone_e164         text        not null,
  provider_chat_id   text,
  state              text        not null default 'awaiting_delivered',
  opening_sent_at    timestamptz,
  delivered_at       timestamptz,
  stopped_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint quote_followup_sequences_state_valid check (
    state in (
      'awaiting_delivered',
      'active',
      'paused',
      'stopped',
      'completed',
      'delivery_failed'
    )
  ),
  constraint quote_followup_sequences_phone_e164_format check (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint quote_followup_sequences_provider_chat_id_nonempty check (
    provider_chat_id is null or btrim(provider_chat_id) <> ''
  )
);

comment on table quote_followup_sequences is
  'One follow-up sequence per quote version. Quota is held only in awaiting_delivered, active, paused.';
comment on column quote_followup_sequences.phone_e164 is
  'E.164 with leading plus. Quota key. Not the Whapi `to` send field.';
comment on column quote_followup_sequences.provider_chat_id is
  'Whapi chat id from a send response. Separate from phone_e164.';

create index if not exists quote_followup_sequences_quote_id_idx
  on quote_followup_sequences (quote_id);

-- Partial unique indexes are the quota enforcement. A plain unique index is not enough.
create unique index if not exists quote_followup_sequences_phone_e164_quota_uidx
  on quote_followup_sequences (phone_e164)
  where state in ('awaiting_delivered', 'active', 'paused');

create unique index if not exists quote_followup_sequences_provider_chat_id_quota_uidx
  on quote_followup_sequences (provider_chat_id)
  where provider_chat_id is not null
    and state in ('awaiting_delivered', 'active', 'paused');

-- ── Steps ───────────────────────────────────────────────────────────────────

create table if not exists quote_followup_steps (
  id                   uuid primary key default gen_random_uuid(),
  sequence_id          uuid        not null references quote_followup_sequences(id) on delete cascade,
  step_kind            text        not null,
  state                text        not null default 'pending',
  scheduled_at         timestamptz,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  sent_text            text,
  provider_message_id  text,
  chat_id              text,
  recipient_id         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint quote_followup_steps_sequence_step_key unique (sequence_id, step_kind),
  constraint quote_followup_steps_kind_valid check (
    step_kind in ('opening', 'followup_1', 'followup_2', 'followup_3')
  ),
  constraint quote_followup_steps_state_valid check (
    state in (
      'pending',
      'sent',
      'delivered',
      'send_failed',
      'delivery_failed',
      'skipped',
      'cancelled_before_send'
    )
  )
);

comment on table quote_followup_steps is
  'One row per step on a sequence. Unique on sequence + step_kind — one automatic message per step.';
comment on column quote_followup_steps.sent_text is
  'Rendered text that was sent. Stored for quote history.';
comment on column quote_followup_steps.provider_message_id is
  'Whapi message.id returned from send.';

create index if not exists quote_followup_steps_sequence_idx
  on quote_followup_steps (sequence_id, scheduled_at);

create index if not exists quote_followup_steps_message_id_idx
  on quote_followup_steps (provider_message_id)
  where provider_message_id is not null;

-- ── Inbound events (delivery statuses and inbound messages) ─────────────────
-- Insertable without an existing step message id. Nullable sequence/step FKs
-- allow later association. Unique on message id + status rejects duplicates.

create table if not exists quote_followup_inbound_events (
  id                   uuid primary key default gen_random_uuid(),
  provider_message_id  text        not null,
  status               text        not null,
  recipient_id         text,
  chat_id              text,
  from_id              text,
  text_body            text,
  event_at             timestamptz,
  quoted_id            text,
  sequence_id          uuid        references quote_followup_sequences(id) on delete set null,
  step_id              uuid        references quote_followup_steps(id) on delete set null,
  created_at           timestamptz not null default now(),

  constraint quote_followup_inbound_events_message_status_key
    unique (provider_message_id, status)
);

comment on table quote_followup_inbound_events is
  'Whapi status and inbound-message events. Unique on message id + status. Matchable later via nullable FKs and provider ids.';
comment on column quote_followup_inbound_events.from_id is
  'Whapi `from` field.';
comment on column quote_followup_inbound_events.quoted_id is
  'Whapi context.quoted_id when present.';

create index if not exists quote_followup_inbound_events_chat_id_idx
  on quote_followup_inbound_events (chat_id)
  where chat_id is not null;

create index if not exists quote_followup_inbound_events_step_idx
  on quote_followup_inbound_events (step_id)
  where step_id is not null;

-- ── Settings (exactly one row) ──────────────────────────────────────────────

create table if not exists quote_followup_settings (
  id                       smallint primary key default 1,
  enabled                  boolean     not null default false,
  window_start             time        not null default time '09:00',
  window_end               time        not null default time '18:00',
  business_days            text[]      not null default array['sunday','monday','tuesday','wednesday','thursday']::text[],
  followup_1_offset_days   integer     not null default 2,
  followup_2_offset_days   integer     not null default 5,
  followup_3_offset_days   integer     not null default 10,
  template_opening         text        not null,
  template_followup_1      text        not null,
  template_followup_2      text        not null,
  template_followup_3      text        not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint quote_followup_settings_singleton check (id = 1),
  constraint quote_followup_settings_window_order check (window_start < window_end),
  constraint quote_followup_settings_offsets_positive check (
    followup_1_offset_days > 0
    and followup_2_offset_days > 0
    and followup_3_offset_days > 0
  ),
  constraint quote_followup_settings_business_days_valid check (
    business_days <> '{}'
    and business_days <@ array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::text[]
  )
);

comment on table quote_followup_settings is
  'Singleton follow-up settings. enabled defaults to false until a later issue turns the feature on.';

insert into quote_followup_settings (
  id,
  enabled,
  window_start,
  window_end,
  business_days,
  followup_1_offset_days,
  followup_2_offset_days,
  followup_3_offset_days,
  template_opening,
  template_followup_1,
  template_followup_2,
  template_followup_3
) values (
  1,
  false,
  time '09:00',
  time '18:00',
  array['sunday','monday','tuesday','wednesday','thursday']::text[],
  2,
  5,
  10,
  $opening$שלום {{customer_name}},
מצורפת הצעת המחיר {{quote_number}}.
לצפייה ולחתימה: {{sign_link}}
ההצעה בתוקף עד {{valid_until}}.
{{salesperson_name}}$opening$,
  $followup1$שלום {{customer_name}},
רציתי לוודא שהצעת המחיר {{quote_number}} הגיעה אליך.
לצפייה ולחתימה: {{sign_link}}
ההצעה בתוקף עד {{valid_until}}.$followup1$,
  $followup2$שלום {{customer_name}},
הצעת המחיר {{quote_number}} עדיין ממתינה לאישורך.
לצפייה ולחתימה: {{sign_link}}
תוקף עד {{valid_until}}. אם צריך משהו נוסף, אפשר להשיב להודעה הזו.$followup2$,
  $followup3$שלום {{customer_name}},
זו תזכורת אחרונה לגבי הצעת המחיר {{quote_number}}.
לצפייה ולחתימה: {{sign_link}}
ההצעה בתוקף עד {{valid_until}}. אחרי המועד הלינק לא יהיה פעיל.$followup3$
)
on conflict (id) do nothing;

-- ── Cancel reasons ──────────────────────────────────────────────────────────

create table if not exists quote_cancel_reasons (
  id               uuid primary key default gen_random_uuid(),
  code             text        not null unique,
  label            text        not null,
  requires_detail  boolean     not null default false,
  sort_order       integer     not null default 0,
  is_active        boolean     not null default true,
  is_system        boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table quote_cancel_reasons is
  'Quote cancel reasons. requires_detail is true only for אחר.';

insert into quote_cancel_reasons (code, label, requires_detail, sort_order, is_system) values
  ('not_relevant',               'לא רלוונטי',           false, 10, true),
  ('chose_other_vendor',         'בחר בספק אחר',         false, 20, true),
  ('no_budget',                  'אין תקציב',            false, 30, true),
  ('timing_not_suitable',        'התזמון אינו מתאים',    false, 40, true),
  ('cannot_reach_customer',      'לא ניתן להשיג את הלקוח', false, 50, true),
  ('duplicate_or_wrong_quote',   'הצעה כפולה או שגויה',  false, 60, true),
  ('other',                      'אחר',                  true,  70, true)
on conflict (code) do nothing;

-- ── Communication blocks ────────────────────────────────────────────────────
-- No hard delete. Removal is removed_at. Active means removed_at is null.
-- Unique on an active row by phone_e164, and by provider_chat_id or lid when present.

create table if not exists communication_blocks (
  id                 uuid primary key default gen_random_uuid(),
  phone_e164         text        not null,
  provider_chat_id   text,
  lid                text,
  customer_id        uuid        references customers(id) on delete set null,
  lead_id            uuid        references leads(id) on delete set null,
  created_at         timestamptz not null default now(),
  removed_at         timestamptz,

  constraint communication_blocks_phone_e164_format check (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint communication_blocks_provider_chat_id_nonempty check (
    provider_chat_id is null or btrim(provider_chat_id) <> ''
  ),
  constraint communication_blocks_lid_nonempty check (
    lid is null or btrim(lid) <> ''
  )
);

comment on table communication_blocks is
  'Contact-level send block. Active = removed_at is null. Linked to customer if present, otherwise lead.';
comment on column communication_blocks.lid is
  'Whapi @lid identifier when present. Unique among active rows.';

create unique index if not exists communication_blocks_phone_e164_active_uidx
  on communication_blocks (phone_e164)
  where removed_at is null;

create unique index if not exists communication_blocks_provider_chat_id_active_uidx
  on communication_blocks (provider_chat_id)
  where removed_at is null and provider_chat_id is not null;

create unique index if not exists communication_blocks_lid_active_uidx
  on communication_blocks (lid)
  where removed_at is null and lid is not null;

create or replace function communication_blocks_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'communication_blocks cannot be hard-deleted; set removed_at instead';
end;
$$;

drop trigger if exists communication_blocks_no_delete on communication_blocks;
create trigger communication_blocks_no_delete
  before delete on communication_blocks
  for each row
  execute function communication_blocks_forbid_delete();

-- ── Quote activity (append-only history) ────────────────────────────────────

create table if not exists quote_activity (
  id                 uuid primary key default gen_random_uuid(),
  quote_id           uuid        not null references quotes(id) on delete restrict,
  quote_version_id   uuid        references quote_versions(id) on delete restrict,
  sequence_id        uuid        references quote_followup_sequences(id) on delete restrict,
  event_kind         text        not null,
  actor_type         text        not null,
  actor_user_id      uuid        references app_users(id) on delete set null,
  payload            jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  constraint quote_activity_event_kind_valid check (
    event_kind in (
      'message_sent',
      'result',
      'handled_personally',
      'resume',
      'stop',
      'schedule_change',
      'skip',
      'cancel_with_reason',
      'signature',
      'new_version',
      'stop_messages_and_block'
    )
  ),
  constraint quote_activity_actor_type_valid check (
    actor_type in ('system', 'user')
  )
);

comment on table quote_activity is
  'Append-only quote history. Deletes are blocked by trigger. Ordered by created_at.';

create index if not exists quote_activity_quote_created_idx
  on quote_activity (quote_id, created_at);

create or replace function quote_activity_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quote_activity is append-only; deletes are not allowed';
end;
$$;

drop trigger if exists quote_activity_no_delete on quote_activity;
create trigger quote_activity_no_delete
  before delete on quote_activity
  for each row
  execute function quote_activity_forbid_delete();

commit;

-- ============================================================================
-- Read-only verification (safe after COMMIT)
-- ============================================================================

-- Expected: quote_status values unchanged (this migration must not add any)
select e.enumlabel
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
 where t.typname = 'quote_status'
 order by e.enumsortorder;

-- Expected: 7 new tables
select tablename
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'quote_followup_sequences',
     'quote_followup_steps',
     'quote_followup_inbound_events',
     'quote_followup_settings',
     'quote_cancel_reasons',
     'communication_blocks',
     'quote_activity'
   )
 order by tablename;

-- Expected: partial unique indexes (WHERE clause present)
select indexname, indexdef
  from pg_indexes
 where indexname in (
   'quote_followup_sequences_phone_e164_quota_uidx',
   'quote_followup_sequences_provider_chat_id_quota_uidx',
   'communication_blocks_phone_e164_active_uidx',
   'communication_blocks_provider_chat_id_active_uidx',
   'communication_blocks_lid_active_uidx'
 )
 order by indexname;

-- Expected: 1 settings row, enabled = false
select id, enabled, window_start, window_end, business_days,
       followup_1_offset_days, followup_2_offset_days, followup_3_offset_days
  from quote_followup_settings;

-- Expected: 7 reasons; only 'other' has requires_detail
select code, label, requires_detail, sort_order
  from quote_cancel_reasons
 order by sort_order;
