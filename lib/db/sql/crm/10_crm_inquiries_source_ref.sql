-- ============================================================================
-- 10_crm_inquiries_source_ref.sql
-- מודול CRM · מפתח מקור לפנייה — הגנה מפני פניות כפולות
--
-- למה: crm_inquiries הוא append-only ואין בו שום מפתח ייחודי. מטא שולחת
--      retry על כל תשובה שאינה 200, וסריקת ה-Sweep (כל 15 דק') יכולה להביא
--      ליד שכבר נקלט. בלי המפתח הזה אותה השארת פרטים אחת תיצור שתי פניות,
--      inquiry_number יקפוץ ל-2, ותידלק ההתראה "השאיר פרטים שוב" על סמך
--      כפילות טכנית בלבד.
--
-- מה: source + source_ref על crm_inquiries, ואינדקס ייחודי חלקי עליהם.
--     ingestLead() יעשה insert ... on conflict do nothing ויחזיר 200.
--
-- בטיחות: תוספת עמודות nullable / עם default לטבלה של ה-CRM בלבד.
--          שום טבלה קיימת לא נוגעת. ריצה חוזרת לא מזיקה.
--
-- להריץ אחרי 04_crm_leads.sql. לפני שגל 4 נבנה.
-- ============================================================================

begin;

alter table crm_inquiries
  add column if not exists source     text not null default 'crm',
  add column if not exists source_ref text;

comment on column crm_inquiries.source is
  'crm | manual | monday | facebook_lead_ads — מאיזה ערוץ הגיעה הפנייה';
comment on column crm_inquiries.source_ref is
  'המזהה של הפנייה במערכת המקור. ל-facebook_lead_ads זהו leadgen_id. null כשאין מזהה חיצוני';

-- הזוג (source, source_ref) ייחודי, ולא source_ref לבדו:
-- מזהה של מטא ומזהה של מנדיי יכולים להתנגש כמחרוזות.
-- חלקי — שורות בלי source_ref (יצירה ידנית) לא נכנסות לאילוץ כלל.
create unique index if not exists crm_inquiries_source_ref_uidx
  on crm_inquiries (source, source_ref)
  where source_ref is not null;

commit;

-- ============================================================================
-- אימות
-- ============================================================================

-- 1. שתי העמודות קיימות, source לא nullable עם default
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'crm_inquiries' and column_name in ('source', 'source_ref');
-- צפוי: 2 שורות. source = text / NO / 'crm'::text · source_ref = text / YES / null

-- 2. האינדקס נוצר וחלקי
select indexname, indexdef
  from pg_indexes
 where tablename = 'crm_inquiries' and indexname = 'crm_inquiries_source_ref_uidx';
-- צפוי: שורה אחת, ובסופה  WHERE (source_ref IS NOT NULL)

-- 3. הפניות שכבר קיימות קיבלו source='crm' ולא נפגעו
select source, count(*) as rows, count(source_ref) as with_ref
  from crm_inquiries
 group by source;
