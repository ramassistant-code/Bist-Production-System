-- ============================================================================
-- 01_crm_lookup.sql
-- מודול CRM · גל 1א · טבלאות הבסיס: סטטוסי טיפול + סיבות אי-רלוונטיות
--
-- להריץ ב-Supabase SQL Editor.
--
-- ⚠️ תוספתי לחלוטין. אף טבלה קיימת אינה משתנה, ולו בעמודה אחת.
--    בגרסה קודמת של הקובץ הזה הוספנו requires_detail ל-lookup_rejection_reason
--    הקיימת. זה בוטל: לוגיקה עסקית חוסמת של מודול חדש לא תישען על טבלה ישנה,
--    ולא נשנה טבלה שקוד קיים קורא ממנה. crm_rejection_reasons עצמאית לגמרי.
-- ============================================================================

begin;

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

commit;

-- ============================================================================
-- בדיקות — להריץ אחרי ה-COMMIT ולוודא את הפלט
-- ============================================================================

-- צפוי: 7
select count(*) as status_count from crm_lead_statuses;

-- צפוי: 7 שורות, כולן is_system = true
select code, label, sort_order, is_system
  from crm_lead_statuses
 order by sort_order;

-- צפוי: 5 שורות. רק 'other' עם requires_detail = true
select code, label, requires_detail, sort_order
  from crm_rejection_reasons
 order by sort_order;

-- צפוי: 1
select count(*) as must_be_one
  from crm_rejection_reasons
 where requires_detail = true;

-- ✅ אימות שהטבלה הישנה לא נגעה: צפוי 0 שורות
select column_name
  from information_schema.columns
 where table_name = 'lookup_rejection_reason'
   and column_name = 'requires_detail';
