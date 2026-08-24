-- ============================================================================
-- 05_crm_activity.sql
-- מודול CRM · גל 1א · הערות, משימות ויומן שיחות
-- אפיון סעיפים 3.5, 3.6, 3.7
-- ============================================================================

begin;

-- ── הערות (3.5) ─────────────────────────────────────────────────────────────
-- הערה לא נמחקת. ניתנת לעריכה על ידי הכותב בלבד וב-15 הדקות הראשונות.
-- החלון נאכף בקוד; edited_at כאן לתיעוד בלבד.
create table if not exists crm_lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid        not null references crm_leads(id) on delete cascade,
  user_id    uuid        references app_users(id)          on delete set null,
  content    text        not null,
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  constraint crm_lead_notes_content_not_blank check (btrim(content) <> '')
);

comment on table crm_lead_notes is 'הערות חופשיות על ליד. לא נמחקות. עריכה לכותב בלבד וב-15 דקות הראשונות';

create index if not exists crm_lead_notes_lead_idx
  on crm_lead_notes (lead_id, created_at desc);

-- ── משימות (3.6) ────────────────────────────────────────────────────────────
-- אין משימה ללא תאריך — due_at הוא NOT NULL, זו דרישה חוסמת באפיון.
create table if not exists crm_lead_tasks (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid        not null references crm_leads(id) on delete cascade,
  assigned_user_id uuid        references app_users(id)          on delete set null,
  title            text        not null,
  description      text,
  due_at           timestamptz not null,
  status           text        not null default 'open',
  source           text        not null default 'manual',
  completed_at     timestamptz,

  -- "דחה" בנודניק — החלון חוזר בעוד שעה (אפיון 7.3)
  snoozed_until    timestamptz,

  -- נשלחת פעם אחת בלבד (אפיון 7.2). זה מה שהופך את ה-sweep ל-idempotent
  whatsapp_sent_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint crm_lead_tasks_status_valid check (status in ('open', 'done')),
  constraint crm_lead_tasks_source_valid check (source in ('manual', 'status_auto')),
  constraint crm_lead_tasks_title_not_blank check (btrim(title) <> ''),
  constraint crm_lead_tasks_done_has_time
    check (status <> 'done' or completed_at is not null)
);

comment on table  crm_lead_tasks is 'משימות על ליד. תאריך יעד חובה — אין משימה ללא תאריך';
comment on column crm_lead_tasks.source           is 'manual = ידני, status_auto = נוצרה אוטומטית בשינוי סטטוס (אפיון 7.1)';
comment on column crm_lead_tasks.whatsapp_sent_at is 'חותמת שליחה. מונעת הודעה כפולה כשה-sweep רץ פעמיים';
comment on column crm_lead_tasks.snoozed_until    is 'דחיית הנודניק בשעה. לא משפיע על שליחת ה-WhatsApp';

-- האינדקס שה-sweep של n8n רץ עליו: משימות פתוחות שהבשילו וטרם נשלחו
create index if not exists crm_lead_tasks_due_sweep_idx
  on crm_lead_tasks (due_at)
  where status = 'open' and whatsapp_sent_at is null;

create index if not exists crm_lead_tasks_open_idx
  on crm_lead_tasks (assigned_user_id, due_at)
  where status = 'open';

create index if not exists crm_lead_tasks_lead_idx on crm_lead_tasks (lead_id, due_at);

-- חותמת ביצוע אוטומטית בסימון "בוצעה"
create or replace function crm_task_stamp_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status = 'open' then
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_lead_tasks_completion on crm_lead_tasks;
create trigger crm_lead_tasks_completion
  before update on crm_lead_tasks
  for each row
  execute function crm_task_stamp_completion();

-- ── יומן שיחות (3.7) ────────────────────────────────────────────────────────
-- נוצר אוטומטית בלבד, מ-Webhook של VoiceCenter. אין יצירה או עריכה ידנית.
-- lead_id nullable בכוונה: שיחה למספר שאינו קיים כליד נשמרת ללא שיוך
-- ומדווחת לאדמין (אפיון 8.1).
create table if not exists crm_call_logs (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid        references crm_leads(id) on delete set null,
  user_id             uuid        references app_users(id) on delete set null,
  phone_e164          text,
  direction           text        not null,
  started_at          timestamptz not null default now(),
  duration_sec        integer     not null default 0,
  result              text        not null,
  recording_url       text,
  ai_summary          text,

  -- ייחודי — מונע כפילות ב-Webhook חוזר וקידום כפול של המונה
  voicecenter_call_id text        not null unique,

  raw_payload         jsonb,
  created_at          timestamptz not null default now(),

  constraint crm_call_logs_direction_valid check (direction in ('outbound', 'inbound')),
  constraint crm_call_logs_result_valid
    check (result in ('answered', 'no_answer', 'busy', 'wrong_number')),
  constraint crm_call_logs_duration_nonneg check (duration_sec >= 0)
);

comment on table  crm_call_logs is 'יומן שיחות. נוצר אוטומטית מ-VoiceCenter בלבד';
comment on column crm_call_logs.voicecenter_call_id is 'ייחודי — ה-Webhook חייב להיות Idempotent (אפיון 8.1)';
comment on column crm_call_logs.lead_id is 'ריק = שיחה למספר שאינו ליד. נשמרת ומדווחת לאדמין';

create index if not exists crm_call_logs_lead_idx on crm_call_logs (lead_id, started_at desc);
create index if not exists crm_call_logs_unmatched_idx
  on crm_call_logs (started_at desc) where lead_id is null;

commit;

-- ============================================================================
-- בדיקות
-- ============================================================================

-- הכנה
insert into crm_leads (name, phone_e164) values ('בדיקה — למחיקה', '+972500000002');

-- 1. משימה ללא תאריך → אמורה להיכשל. להריץ בנפרד:
-- insert into crm_lead_tasks (lead_id, title)
-- select id, 'בלי תאריך' from crm_leads where phone_e164 = '+972500000002';

-- 2. משימה תקינה
insert into crm_lead_tasks (lead_id, title, due_at)
select id, 'לחזור ללקוח', now() + interval '2 minutes'
  from crm_leads where phone_e164 = '+972500000002';

-- 3. שאילתת ה-sweep — זו שתרוץ מ-n8n כל דקה
-- צפוי: 0 עכשיו, 1 בעוד שתי דקות
select count(*) as due_now
  from crm_lead_tasks
 where status = 'open' and whatsapp_sent_at is null and due_at <= now();

-- 4. סימון כבוצעה → completed_at נחתם אוטומטית
update crm_lead_tasks set status = 'done'
 where lead_id = (select id from crm_leads where phone_e164 = '+972500000002');

-- צפוי: status = done, completed_at מלא
select title, status, completed_at from crm_lead_tasks
 where lead_id = (select id from crm_leads where phone_e164 = '+972500000002');

-- 5. שיחה כפולה → אמורה להיכשל על unique. להריץ פעמיים ולוודא שהשנייה נכשלת:
insert into crm_call_logs (lead_id, direction, result, voicecenter_call_id, duration_sec)
select id, 'outbound', 'no_answer', 'VC_TEST_1', 0
  from crm_leads where phone_e164 = '+972500000002';

-- ניקוי
delete from crm_call_logs where voicecenter_call_id = 'VC_TEST_1';
delete from crm_leads where phone_e164 = '+972500000002';
