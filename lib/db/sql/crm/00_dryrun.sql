-- ============================================================================
-- 00_dryrun.sql
-- מודול CRM · בדיקה יבשה — בטוחה להרצה ישירות על הייצור
--
-- כל הסקריפטים 01–06 מאוחדים לטרנזקציה אחת שמסתיימת ב-ROLLBACK.
-- שום דבר לא נשמר. אם הקובץ רץ עד הסוף בלי שגיאה — ה-SQL תקין מול
-- הסכימה האמיתית שלך, כולל כל ה-FK אל app_users / leads / customers.
--
-- ⚠️ הערה אחת כנה: יצירת FK נועלת לרגע את הטבלה שאליה מפנים
--    (app_users, leads, customers). הנעילה קצרצרה — הטבלאות החדשות ריקות
--    ואין מה לאמת — אבל עדיף להריץ בשעה שקטה ולא באמצע יום מכירות.
--
-- אופן ההרצה: להדביק את כל הקובץ ב-SQL Editor ולהריץ פעם אחת.
-- ============================================================================

begin;

-- ┌── 01_crm_lookup.sql ─────────────────────────────────────────
-- ── סטטוסי טיפול (אפיון סעיף 4) ─────────────────────────────────────────────
-- code הוא המפתח שהלוגיקה בקוד נתלית בו. label ניתן לשינוי על ידי אדמין
-- בלי לשבור דבר. is_system מסמן את שבעת הסטטוסים שיש להם לוגיקה קשיחה —
-- אסור למחוק אותם. סטטוס שאדמין יוסיף יקבל is_system = false וללא לוגיקה.
create table if not exists crm_lead_statuses (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique,
  label       text        not null,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  is_system   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  crm_lead_statuses is 'סטטוסי טיפול בליד. code מניע לוגיקה בקוד, label לתצוגה בלבד';
comment on column crm_lead_statuses.code      is 'מפתח קשיח — אין לשנות עבור is_system = true';
comment on column crm_lead_statuses.is_system is 'true = סטטוס עם לוגיקה קשיחה בקוד, אין למחוק';

insert into crm_lead_statuses (code, label, sort_order, is_system) values
  ('new',            'חדש',          10, true),
  ('no_answer',      'אין מענה',     20, true),
  ('pipe',           'פייפ',         30, true),
  ('long_followup',  'פולואפ ארוך',  40, true),
  ('paid',           'שילם',         50, true),
  ('not_relevant',   'לא רלוונטי',   60, true),
  ('wrong_number',   'מספר שגוי',    70, true)
on conflict (code) do nothing;

-- ── סיבות אי-רלוונטיות (אפיון סעיף 4.1) ────────────────────────────────────
-- טבלה עצמאית של המודול. אדמין יכול להוסיף סיבות בלי שינוי קוד.
-- requires_detail = true → חובה גם פירוט חופשי, והמעבר נחסם בלעדיו.
create table if not exists crm_rejection_reasons (
  id              uuid primary key default gen_random_uuid(),
  code            text        not null unique,
  label           text        not null,
  requires_detail boolean     not null default false,
  sort_order      integer     not null default 0,
  is_active       boolean     not null default true,
  is_system       boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table  crm_rejection_reasons is 'סיבות אי-רלוונטיות. עצמאית — אינה קשורה ל-lookup_rejection_reason הישנה';
comment on column crm_rejection_reasons.requires_detail is 'true = חובה למלא פירוט חופשי. חוסם שמירה בלעדיו (אפיון 4.1)';
comment on column crm_rejection_reasons.code is 'מפתח קשיח. הלוגיקה בקוד נתלית בו, לא ב-label';
-- הערה עסקית: 'זמן תגובה' הוא מדד הבקרה החשוב ביותר במערכת —
-- שיעור גבוה שלו מצביע ישירות על כשל במהירות המענה (אפיון 4.1).

insert into crm_rejection_reasons (code, label, requires_detail, sort_order, is_system) values
  ('response_time', 'זמן תגובה', false, 10, true),
  ('price',         'מחיר',      false, 20, true),
  ('competition',   'תחרות',     false, 30, true),
  ('distance',      'מרחק',      false, 40, true),
  ('other',         'אחר',       true,  50, true)
on conflict (code) do nothing;

-- ┌── 02_crm_funnels.sql ────────────────────────────────────────
-- ── משפכים ──────────────────────────────────────────────────────────────────
create table if not exists crm_funnels (
  id                    uuid primary key default gen_random_uuid(),
  name                  text        not null unique,
  current_cost_per_lead numeric(12,2),
  cost_updated_at       timestamptz,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table  crm_funnels is 'משפך שיווקי. נוצר ומנוהל ידנית על ידי אדמין בלבד — לעולם לא אוטומטית';
comment on column crm_funnels.current_cost_per_lead is 'עלות לליד נוכחית בשקלים. מוזן ידנית, בדרך כלל בתחילת חודש';
comment on column crm_funnels.is_active is 'משפך לא פעיל אינו מקבל לידים חדשים אך נשמר להיסטוריה';

-- ── היסטוריית עלות ──────────────────────────────────────────────────────────
create table if not exists crm_funnel_cost_history (
  id            uuid primary key default gen_random_uuid(),
  funnel_id     uuid        not null references crm_funnels(id) on delete cascade,
  cost_per_lead numeric(12,2) not null,
  valid_from    date        not null default current_date,
  valid_to      date,
  updated_by    uuid        references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint crm_funnel_cost_history_range_valid
    check (valid_to is null or valid_to >= valid_from)
);

comment on table  crm_funnel_cost_history is 'תקופות תוקף של עלות לליד. valid_to ריק = התקופה הפעילה';
comment on column crm_funnel_cost_history.valid_to is 'ריק = זו הרשומה הפעילה כרגע';

create index if not exists crm_funnel_cost_history_funnel_idx
  on crm_funnel_cost_history (funnel_id, valid_from desc);

-- תקופה פתוחה אחת בלבד לכל משפך
create unique index if not exists crm_funnel_cost_history_one_open_idx
  on crm_funnel_cost_history (funnel_id)
  where valid_to is null;

-- ── טריגרים: תיעוד עלות ─────────────────────────────────────────────────────
-- מפוצל לשניים בכוונה:
--   BEFORE  — חותם תאריכים על השורה עצמה (אפשר לגעת ב-NEW)
--   AFTER   — כותב להיסטוריה (שורת המשפך כבר קיימת, כך שה-FK תקף)
-- ⚠️ אסור לכתוב להיסטוריה ב-BEFORE INSERT: שורת המשפך עדיין לא קיימת
--    וה-FK ל-crm_funnels ייכשל.

create or replace function crm_funnel_cost_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.current_cost_per_lead is not null
     and (tg_op = 'INSERT'
          or old.current_cost_per_lead is distinct from new.current_cost_per_lead) then
    new.cost_updated_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function crm_funnel_cost_track()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  if new.current_cost_per_lead is null then
    return null;
  end if;

  -- בעדכון: לתעד רק אם העלות באמת השתנתה
  if tg_op = 'UPDATE'
     and old.current_cost_per_lead is not distinct from new.current_cost_per_lead then
    return null;
  end if;

  -- מזהה המשתמש מגיע מהאפליקציה כ-SET LOCAL crm.actor_id = '<uuid>'.
  -- אם לא הוגדר (עדכון ידני ב-Studio) — נשמר null.
  begin
    v_actor := nullif(current_setting('crm.actor_id', true), '')::uuid;
  exception when others then
    v_actor := null;
  end;

  -- סגירת התקופה הפעילה
  update crm_funnel_cost_history
     set valid_to = current_date
   where funnel_id = new.id
     and valid_to is null;

  -- פתיחת תקופה חדשה
  insert into crm_funnel_cost_history (funnel_id, cost_per_lead, valid_from, updated_by)
  values (new.id, new.current_cost_per_lead, current_date, v_actor);

  return null;
end;
$$;

drop trigger if exists crm_funnels_cost_stamp on crm_funnels;
create trigger crm_funnels_cost_stamp
  before insert or update of current_cost_per_lead on crm_funnels
  for each row
  execute function crm_funnel_cost_stamp();

drop trigger if exists crm_funnels_cost_track on crm_funnels;
create trigger crm_funnels_cost_track
  after insert or update of current_cost_per_lead on crm_funnels
  for each row
  execute function crm_funnel_cost_track();

-- ┌── 03_crm_ads.sql ────────────────────────────────────────────
create table if not exists crm_ads (
  id              uuid primary key default gen_random_uuid(),
  facebook_ad_id  text        not null unique,
  name            text,
  ad_url          text,
  funnel_id       uuid        references crm_funnels(id) on delete set null,
  last_synced_at  timestamptz,
  fetch_failed    boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table  crm_ads is 'מודעות Facebook. נמשכות אוטומטית On Demand — אין יצירה ידנית';
comment on column crm_ads.facebook_ad_id is 'המזהה המקורי מ-Facebook. ייחודי — מונע כפילויות בסנכרון';
comment on column crm_ads.funnel_id      is 'ריק = מודעה שטרם קושרה. הקישור ידני על ידי אדמין בלבד';
comment on column crm_ads.ad_url         is 'לינק ישיר לצפייה במודעה. נשלח בהודעת ה-WhatsApp לאיש המכירות';
comment on column crm_ads.fetch_failed   is 'true = המשיכה מ-Facebook נכשלה ונוצרה רשומה חלקית. להשלמה בניסיון הבא';

-- "מודעות ממתינות לקישור" — ה-View שהאדמין רואה, וה-workflow היומי ב-n8n
create index if not exists crm_ads_unlinked_idx
  on crm_ads (created_at desc)
  where funnel_id is null;

create index if not exists crm_ads_funnel_idx on crm_ads (funnel_id);

-- ┌── 04_crm_leads.sql ──────────────────────────────────────────
-- ── לידים ───────────────────────────────────────────────────────────────────
create table if not exists crm_leads (
  id                    uuid primary key default gen_random_uuid(),
  name                  text        not null,

  -- מפתח הזיהוי. E.164 מלא, למשל +972501234567
  phone_e164            text        not null unique,
  phone_raw             text,
  email                 text,

  sales_rep_id          uuid        references app_users(id)         on delete set null,
  status_code           text        not null default 'new'
                                    references crm_lead_statuses(code)
                                    on update cascade,

  is_active_customer    boolean     not null default false,
  answer_status         text,
  capture_attempts      integer     not null default 0,

  rejection_reason_code text        references crm_rejection_reasons(code) on update cascade,
  rejection_detail      text,

  pending_reassignment  boolean     not null default false,

  -- קישור למערכת הקיימת — נשמר בצד ה-CRM בלבד
  legacy_lead_id        uuid        references leads(id)             on delete set null,
  linked_customer_id    uuid        references customers(id)         on delete set null,

  -- מקור לצורכי מיגרציה וביקורת
  source                text        not null default 'crm',
  source_ref            text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint crm_leads_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint crm_leads_capture_attempts_nonneg check (capture_attempts >= 0)
);

comment on table  crm_leads is 'ליד = אדם אחד. מזוהה לפי טלפון מנורמל E.164';
comment on column crm_leads.phone_e164         is 'מפתח זיהוי ייחודי. נורמל ל-E.164 לפני שמירה והשוואה';
comment on column crm_leads.is_active_customer is 'נדלק ברכישה ראשונה ולעולם לא חוזר ל-false (אפיון 4.3)';
comment on column crm_leads.capture_attempts   is 'מונה אוטומטי בלבד. Read Only בכל ממשק (אפיון סעיף 6)';
comment on column crm_leads.rejection_reason_code is 'FK לטבלת crm_rejection_reasons. חובה בסטטוס not_relevant (אפיון 4.1)';
comment on column crm_leads.rejection_detail    is 'חובה כשלסיבה שנבחרה requires_detail = true';
comment on column crm_leads.pending_reassignment is 'true = הליד ב-Pool "ממתין להשמה" אחרי שאיש המכירות עזב (אפיון 5.5)';
comment on column crm_leads.legacy_lead_id     is 'הליד המקביל בטבלת leads הישנה. ממולא במיגרציה';
comment on column crm_leads.source             is 'crm | monday | manual — לצורכי ביקורת ושחזור';

create index if not exists crm_leads_rep_status_idx
  on crm_leads (sales_rep_id, status_code)
  where deleted_at is null;

create index if not exists crm_leads_status_idx
  on crm_leads (status_code)
  where deleted_at is null;

create index if not exists crm_leads_pending_idx
  on crm_leads (updated_at desc)
  where pending_reassignment = true and deleted_at is null;

create index if not exists crm_leads_legacy_idx on crm_leads (legacy_lead_id);

-- ── פניות ───────────────────────────────────────────────────────────────────
create table if not exists crm_inquiries (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid        not null references crm_leads(id)  on delete cascade,
  ad_id          uuid        references crm_ads(id)             on delete set null,
  funnel_id      uuid        references crm_funnels(id)         on delete set null,
  form_name      text,
  free_text      text,
  inquiry_at     timestamptz not null default now(),
  inquiry_number integer     not null default 1,

  -- קריטי לדיבוג ולשחזור. נשמר לפני כל עיבוד (אפיון 5.1 שלב 1)
  raw_payload    jsonb       not null default '{}'::jsonb,

  created_at     timestamptz not null default now()
);

comment on table  crm_inquiries is 'פנייה = השארת פרטים אחת. לעולם לא נמחקת ולא נערכת';
comment on column crm_inquiries.inquiry_number is '1 לפנייה ראשונה, 2 לשנייה וכן הלאה. גדול מ-1 מפעיל תיוג והתראה (אפיון 5.3)';
comment on column crm_inquiries.raw_payload    is 'ה-Payload המלא כפי שהתקבל. נשמר לפני כל עיבוד';
comment on column crm_inquiries.funnel_id      is 'נגזר מהמודעה. ממולא רטרואקטיבית כשהמודעה מקושרת (אפיון 8.3 שלב 7)';

create index if not exists crm_inquiries_lead_idx on crm_inquiries (lead_id, inquiry_at desc);
create index if not exists crm_inquiries_ad_idx   on crm_inquiries (ad_id);

-- ── טריגר: מספור פניות אוטומטי לכל ליד ─────────────────────────────────────
-- מחליף את השדה "השאיר פרטים פעם נוספת" מהחומר הגולמי.
create or replace function crm_inquiry_set_number()
returns trigger
language plpgsql
as $$
begin
  select coalesce(max(inquiry_number), 0) + 1
    into new.inquiry_number
    from crm_inquiries
   where lead_id = new.lead_id;
  return new;
end;
$$;

drop trigger if exists crm_inquiries_number on crm_inquiries;
create trigger crm_inquiries_number
  before insert on crm_inquiries
  for each row
  execute function crm_inquiry_set_number();

-- ┌── 05_crm_activity.sql ───────────────────────────────────────
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

-- ┌── 06_crm_ops.sql ────────────────────────────────────────────
-- ── זמינות (3.8) ────────────────────────────────────────────────────────────
-- אין איפוס אוטומטי בסוף יום עסקים. הדגל נשאר עד לשינוי ידני של מנהל
-- המכירות (החלטה 8 באפיון).
create table if not exists crm_rep_availability (
  user_id          uuid primary key references app_users(id) on delete cascade,
  is_active_today  boolean     not null default false,
  queue_position   integer     not null default 0,

  -- בסיס הרוטציה: הבא בתור הוא הפעיל עם last_assigned_at הישן ביותר
  last_assigned_at timestamptz,
  leads_today      integer     not null default 0,
  leads_today_date date,

  updated_by       uuid        references app_users(id) on delete set null,
  updated_at       timestamptz not null default now()
);

comment on table  crm_rep_availability is 'זמינות יומית לחלוקת RoundRobin. אין איפוס אוטומטי';
comment on column crm_rep_availability.last_assigned_at is 'בסיס הרוטציה — הבא בתור הוא הפעיל הוותיק ביותר';
comment on column crm_rep_availability.leads_today      is 'מונה תצוגה למסך הזמינות. מתאפס כש-leads_today_date אינו היום';

-- האינדקס שבחירת "הבא בתור" רצה עליו
create index if not exists crm_rep_availability_next_idx
  on crm_rep_availability (last_assigned_at nulls first, queue_position)
  where is_active_today = true;

-- ── יומן ביקורת (5.4, 10) ───────────────────────────────────────────────────
create table if not exists crm_audit_log (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text        not null,
  entity_id     uuid,
  action        text        not null,
  actor_user_id uuid        references app_users(id) on delete set null,
  details       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table  crm_audit_log is 'יומן ביקורת למודול ה-CRM: שינויי זמינות, העברות Bulk, שיוך מחדש';
comment on column crm_audit_log.action  is 'לדוגמה: availability_toggled, lead_reassigned, bulk_transfer, cost_updated';
comment on column crm_audit_log.details is 'לפני/אחרי, כמויות, ומי הועבר למי';

create index if not exists crm_audit_log_entity_idx
  on crm_audit_log (entity_type, entity_id, created_at desc);
create index if not exists crm_audit_log_actor_idx
  on crm_audit_log (actor_user_id, created_at desc);

-- ── בחירת הבא בתור (5.2) ───────────────────────────────────────────────────
-- פונקציה אחת שמרכזת את כלל ה-RoundRobin, עם נעילת שורה כדי ששתי קליטות
-- מקבילות לא יקבלו את אותו איש מכירות.
--
-- מחזירה NULL כשאף איש מכירות אינו פעיל — הקוד הקורא אחראי ליפול
-- למנהל המכירות (השורה הרביעית בטבלת 5.2).
create or replace function crm_next_rep_in_queue()
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  select a.user_id
    into v_user_id
    from crm_rep_availability a
    join app_users u on u.id = a.user_id
   where a.is_active_today = true
     and u.is_active = true
     and u.deleted_at is null
   order by a.last_assigned_at nulls first, a.queue_position, a.user_id
   for update of a skip locked
   limit 1;

  if v_user_id is null then
    return null;
  end if;

  update crm_rep_availability
     set last_assigned_at = now(),
         leads_today = case
           when leads_today_date = current_date then leads_today + 1
           else 1
         end,
         leads_today_date = current_date,
         updated_at = now()
   where user_id = v_user_id;

  return v_user_id;
end;
$$;

comment on function crm_next_rep_in_queue() is
  'מחזיר את איש המכירות הבא בתור ומעדכן את הרוטציה. NULL = אף אחד לא פעיל';

-- ============================================================================
-- אימות בתוך הטרנזקציה — לפני שהכל מתגלגל אחורה
-- ============================================================================

-- צפוי: 12
select count(*) as crm_tables_created
  from information_schema.tables
 where table_schema = 'public' and table_name like 'crm\_%';

-- צפוי: 7
select count(*) as statuses from crm_lead_statuses;

-- צפוי: 5, מתוכן אחת עם requires_detail
select count(*) as reasons,
       count(*) filter (where requires_detail) as requires_detail_count
  from crm_rejection_reasons;

-- צפוי: 5
select count(*) as crm_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'crm\_%';

-- ── בדיקת הטריגר של היסטוריית העלות ────────────────────────────────────────
insert into crm_funnels (name, current_cost_per_lead) values ('DRYRUN', 42.00);
update crm_funnels set current_cost_per_lead = 55.00 where name = 'DRYRUN';

-- צפוי: 2 שורות — הראשונה סגורה (valid_to = היום), השנייה פתוחה (valid_to ריק)
select h.cost_per_lead, h.valid_from, h.valid_to
  from crm_funnel_cost_history h
  join crm_funnels f on f.id = h.funnel_id
 where f.name = 'DRYRUN'
 order by h.created_at;

-- ── בדיקת הליד והפניות ──────────────────────────────────────────────────────
insert into crm_leads (name, phone_e164) values ('DRYRUN', '+972500000099');

insert into crm_inquiries (lead_id, raw_payload)
select id, '{}'::jsonb from crm_leads where phone_e164 = '+972500000099';
insert into crm_inquiries (lead_id, raw_payload)
select id, '{}'::jsonb from crm_leads where phone_e164 = '+972500000099';

-- צפוי: 1 ואז 2 — הטריגר של מספור הפניות עובד
select inquiry_number from crm_inquiries i
  join crm_leads l on l.id = i.lead_id
 where l.phone_e164 = '+972500000099'
 order by inquiry_number;

-- צפוי: null — אין אף איש מכירות מסומן פעיל, אז הליד ילך למנהל המכירות
select crm_next_rep_in_queue() as expect_null;

-- ── מבחן הבידוד: האם משהו קיים תלוי בטבלאות החדשות? ────────────────────────
-- זו הבדיקה המרכזית. אם שתי השאילתות מחזירות 0 שורות, הוכחת שכיוון התלות
-- הוא CRM → קיים בלבד, ושמחיקת המודול לא נוגעת בשום דבר אחר.

-- 1. האם טבלה קיימת מפנה ב-FK אל טבלת crm_? (הכיוון האסור)
--    צפוי: 0 שורות
select con.conname            as constraint_name,
       child.relname          as existing_table_pointing_in,
       parent.relname         as crm_table_pointed_at
  from pg_constraint con
  join pg_class child  on child.oid  = con.conrelid
  join pg_class parent on parent.oid = con.confrelid
 where con.contype = 'f'
   and parent.relname like 'crm\_%'
   and child.relname not like 'crm\_%';

-- 2. האם View / Matview קיים נשען על טבלת crm_?
--    צפוי: 0 שורות
select distinct
       dependent_ns.nspname  as dependent_schema,
       dependent_cls.relname as dependent_object,
       dependent_cls.relkind as kind
  from pg_depend d
  join pg_rewrite   r             on r.oid = d.objid
  join pg_class     dependent_cls on dependent_cls.oid = r.ev_class
  join pg_namespace dependent_ns  on dependent_ns.oid = dependent_cls.relnamespace
  join pg_class     src_cls       on src_cls.oid = d.refobjid
 where src_cls.relname like 'crm\_%'
   and dependent_cls.relname not like 'crm\_%'
   and dependent_cls.relkind in ('v','m');

-- 3. לתיעוד: כל ה-FK שיוצאים מה-CRM אל הקיים (הכיוון המותר)
--    צפוי: הפניות אל app_users / leads / customers בלבד
select child.relname  as crm_table,
       parent.relname as points_at,
       con.confdeltype as on_delete   -- 'n' = SET NULL, 'c' = CASCADE, 'a' = NO ACTION
  from pg_constraint con
  join pg_class child  on child.oid  = con.conrelid
  join pg_class parent on parent.oid = con.confrelid
 where con.contype = 'f'
   and child.relname like 'crm\_%'
   and parent.relname not like 'crm\_%'
 order by child.relname, parent.relname;

-- ============================================================================
-- ROLLBACK — הכל מתגלגל אחורה. ה-DB חוזר בדיוק למצב שלפני ההרצה.
-- ============================================================================
rollback;

-- ── אימות אחרי הרולבק: להריץ בנפרד אחרי שהכל הסתיים ────────────────────────
-- צפוי: 0
-- select count(*) from information_schema.tables
--  where table_schema = 'public' and table_name like 'crm\_%';
