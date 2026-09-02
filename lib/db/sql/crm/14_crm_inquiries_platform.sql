-- ============================================================================
-- 14_crm_inquiries_platform.sql
-- מודול CRM · פלטפורמה ומקור אורגני על הפנייה
--
-- הרקע: ה-payload של מטא מכיל platform ו-is_organic, ושניהם נשמרו עד היום
-- רק בתוך raw_payload. הליד האמיתי הראשון שנקלט הגיע עם platform = "ig" —
-- כלומר מאינסטגרם ולא מפייסבוק. זה נתון שיווקי אמיתי, ובלי עמודה משלו
-- אי אפשר לקבץ לפיו בלי לחפור ב-JSON.
--
-- למה על הפנייה ולא על הליד: אותו אדם יכול להשאיר פרטים פעם באינסטגרם
-- ופעם בפייסבוק. הפלטפורמה היא תכונה של ההשארה, לא של האדם.
--
-- ⚠️ תוספתי. שתי עמודות nullable, אף עמודה קיימת לא משתנה.
-- ============================================================================

begin;

alter table crm_inquiries
  add column if not exists platform   text,
  add column if not exists is_organic boolean;

comment on column crm_inquiries.platform is
  'הפלטפורמה שממנה הגיעה הפנייה כפי שמטא מדווחת: ig | fb | msg. null כשהמקור אינו מטא';
comment on column crm_inquiries.is_organic is
  'true = הפנייה הגיעה מפוסט אורגני ולא ממודעה ממומנת. במקרה כזה אין ad_id ולא נוצרת שורה ב-crm_ads';

create index if not exists crm_inquiries_platform_idx
  on crm_inquiries (platform)
  where platform is not null;

commit;

-- ============================================================================
-- אימות
-- ============================================================================

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'crm_inquiries'
   and column_name in ('platform', 'is_organic')
 order by column_name;
-- צפוי: platform = text / YES · is_organic = boolean / YES

-- הפניות שכבר נקלטו: הערכים קיימים ב-raw_payload ואפשר למלא אותם
-- רטרואקטיבית. זו שאילתת התצוגה — ההשלמה עצמה בבלוק שאחריה.
select count(*)                                                   as inquiries,
       count(*) filter (where raw_payload ? 'platform')           as have_platform_in_raw,
       count(*) filter (where platform is not null)               as have_platform_column
  from crm_inquiries;


-- ── השלמה רטרואקטיבית ───────────────────────────────────────────────────────
-- להריץ פעם אחת אחרי שהעמודות נוצרו. שואב מ-raw_payload את מה שכבר נשמר,
-- ולא נוגע בשורות שאין בהן את השדה.
--
-- update crm_inquiries
--    set platform   = nullif(raw_payload ->> 'platform', ''),
--        is_organic = (raw_payload ->> 'is_organic')::boolean
--  where platform is null
--    and raw_payload ? 'platform';
