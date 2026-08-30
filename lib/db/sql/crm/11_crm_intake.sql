-- ============================================================================
-- 11_crm_intake.sql
-- מודול CRM · הכנת הסכמה לגל 4 — קליטת לידים מ-Meta Lead Ads
--
-- שלושה פערים שהתגלו בהצלבה בין 01–06 לבין מפרט גל 4:
--
--   1. הכלל "קליטת ליד לעולם לא נכשלת" אינו ניתן למימוש כרגע.
--      crm_leads.phone_e164 הוא NOT NULL עם CHECK על E.164, ו-crm_inquiries.lead_id
--      הוא NOT NULL. בלי טלפון תקין אין ליד, ובלי ליד אין לאן לכתוב את ה-payload.
--      טופס בלי שאלת טלפון הוא תרחיש אמיתי במטא — הפנייה פשוט נעלמת.
--
--   2. crm_inquiries.form_id חסר. form_name קיים, אבל שם הטופס משתנה במטא
--      וקיבוץ לפי שם נשבר. המזהה יציב.
--
--   3. crm_ads מקושר ידנית מודעה-מודעה. מטא מייצרת ad_id חדש בכל שכפול או
--      עריכה, כך שרשימת "ממתינות לקישור" מתמלאת גם באותו קמפיין בדיוק.
--
-- ⚠️ הכול תוספתי. אף עמודה קיימת לא משתנה, אף אילוץ לא מוסר.
--    להריץ אחרי 10_crm_inquiries_source_ref.sql, לפני שגל 4 נבנה.
-- ============================================================================

begin;

-- ── 1. טבלת נחיתה לפניות שלא נקלטו ──────────────────────────────────────────
-- ⚠️ בכוונה בלי שום FK, כולל resolved_lead_id. הטבלה הזו היא הרשת האחרונה,
--    והיא חייבת לקבל כתיבה בכל מצב — גם כשהנתון פגום, גם כשהליד לא קיים.
--    FK אחד כאן היה הופך אותה לחסרת ערך בדיוק ברגע שצריך אותה.
create table if not exists crm_intake_failures (
  id               uuid primary key default gen_random_uuid(),
  source           text        not null,
  source_ref       text,
  raw_payload      jsonb       not null default '{}'::jsonb,
  error            text,
  received_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_lead_id uuid
);

comment on table  crm_intake_failures is
  'פניות שנכשלו בקליטה. ingestLead כותב לכאן בכל כשל ומחזיר 200 — הליד לא אובד';
comment on column crm_intake_failures.source_ref is
  'המזהה במערכת המקור. ל-facebook_lead_ads זהו leadgen_id. אין unique — retry של מטא יכול לייצר כמה שורות לאותה פנייה, וזה בסדר';
comment on column crm_intake_failures.error is
  'הסיבה שהקליטה נכשלה, לתצוגה במסך האדמין';
comment on column crm_intake_failures.resolved_lead_id is
  'הליד שנוצר בהשלמה הידנית. ללא FK בכוונה — הטבלה חייבת לקבל כתיבה תמיד';

-- רק הפניות שעדיין לא טופלו, לפי סדר הגעה
create index if not exists crm_intake_failures_open_idx
  on crm_intake_failures (received_at desc)
  where resolved_at is null;

-- ── 2. מזהה טופס יציב על הפנייה ─────────────────────────────────────────────
alter table crm_inquiries
  add column if not exists form_id text;

comment on column crm_inquiries.form_id is
  'מזהה הטופס במערכת המקור. יציב גם כששם הטופס משתנה — form_name אינו';

create index if not exists crm_inquiries_form_idx
  on crm_inquiries (form_id)
  where form_id is not null;

-- ── 3. היררכיית הקמפיין על המודעה ───────────────────────────────────────────
alter table crm_ads
  add column if not exists campaign_id   text,
  add column if not exists campaign_name text,
  add column if not exists adset_id      text,
  add column if not exists adset_name    text;

comment on column crm_ads.campaign_id is
  'מזהה הקמפיין במטא. מודעה חדשה יכולה לרשת ממנו funnel_id — ראו הכלל בתחתית הקובץ';
comment on column crm_ads.adset_id is
  'מזהה קבוצת המודעות. לתצוגה ולניתוח בלבד, אינו משתתף בירושת המשפך';

create index if not exists crm_ads_campaign_idx
  on crm_ads (campaign_id)
  where campaign_id is not null;

-- ── עדכון תיעוד: ערוץ מקור נוסף ─────────────────────────────────────────────
comment on column crm_leads.source is
  'crm | monday | manual | facebook_lead_ads — לצורכי ביקורת ושחזור';

commit;

-- ============================================================================
-- כלל ירושת המשפך — לשימוש ingestLead בגל 4
-- ============================================================================
--
-- כשנכנסת מודעה לא מוכרת עם campaign_id ידוע, אפשר לרשת את המשפך —
-- אבל ⚠️ רק אם כל המודעות הקיימות באותו קמפיין מסכימות על משפך אחד.
-- קמפיין שמשרת שני משפכים יקבל אחרת שיוך שקט ושגוי, ושיוך משפך מזין את
-- עלות-לליד, כלומר החלטות תקציב. בספק — להשאיר null ולתת לאדמין לקשר.
--
-- זו השאילתה המדויקת. היא מחזירה שורה אחת אם ורק אם יש הסכמה מלאה:
--
--   select min(funnel_id) as funnel_id
--     from crm_ads
--    where campaign_id = $1
--      and funnel_id is not null
--   having count(distinct funnel_id) = 1;
--
-- crm_ads.funnel_id נשאר מקור האמת היחיד. זו ברירת מחדל ביצירה בלבד,
-- והאדמין יכול לשנות אותה תמיד.

-- ============================================================================
-- אימות
-- ============================================================================

-- 1. הטבלה קיימת ואין לה אף FK יוצא
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'crm_intake_failures') as table_exists,
  (select count(*) from information_schema.table_constraints
    where table_name = 'crm_intake_failures' and constraint_type = 'FOREIGN KEY') as foreign_keys;
-- צפוי: table_exists = 1 · foreign_keys = 0

-- 2. העמודות החדשות
select table_name, column_name, data_type
  from information_schema.columns
 where (table_name = 'crm_inquiries' and column_name = 'form_id')
    or (table_name = 'crm_ads' and column_name in
        ('campaign_id', 'campaign_name', 'adset_id', 'adset_name'))
 order by table_name, column_name;
-- צפוי: 5 שורות, כולן text

-- 3. האינדקסים החדשים
select tablename, indexname
  from pg_indexes
 where indexname in ('crm_intake_failures_open_idx',
                     'crm_inquiries_form_idx',
                     'crm_ads_campaign_idx')
 order by indexname;
-- צפוי: 3 שורות

-- 4. שום נתון קיים לא נפגע
select
  (select count(*) from crm_leads)     as leads,
  (select count(*) from crm_inquiries) as inquiries,
  (select count(*) from crm_ads)       as ads;
