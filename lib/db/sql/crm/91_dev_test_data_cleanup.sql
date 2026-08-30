-- ============================================================================
-- 91_dev_test_data_cleanup.sql
-- מודול CRM · מחיקת כל נתוני הבדיקה שנוצרו בגלים 2–4
--
-- ⚠️ סביבת פיתוח בלבד. לא להריץ בייצור.
--
-- מה נמחק:
--   לידי "בדיקת scope" (זריעת ההרשאות, קובץ 90)
--   לידי "בדיקת קליטה" ו"ליד ללא שם" (ירי ה-webhook, טלפונים +972599)
--   הפניות, ההערות והמשימות שלהם — נמחקים ב-cascade
--   מודעות הבדיקה, שורות crm_intake_failures ושורות יומן הביקורת
--   איפוס הזמינות: אף אחד לא מסומן זמין, המונים על אפס
--
-- מה לא נמחק: שום נתון אמיתי. משפכים, סטטוסים וסיבות דחייה לא נגעים.
--
-- לזריעה מחדש: 90_dev_scope_test_seed.sql
-- ============================================================================


-- ── שלב 0: לראות מה עומד להימחק לפני שמוחקים ────────────────────────────────
-- להריץ לבד. אם מופיעה כאן שורה שאינה בדיקה — לעצור.
select id, name, phone_e164, status_code, created_at
  from crm_leads
 where name like 'בדיקת scope%'
    or name like 'בדיקת קליטה%'
    or phone_e164 like '+972599%'
 order by created_at;


-- ── שלב 1: המחיקה ───────────────────────────────────────────────────────────
begin;

-- יומן הביקורת ראשון: ל-entity_id אין FK, ולכן הוא לא נמחק ב-cascade
-- ואם נמחק את הלידים קודם, לא תהיה דרך לזהות את שורותיו.
delete from crm_audit_log
 where entity_type = 'crm_lead'
   and entity_id in (
     select id from crm_leads
      where name like 'בדיקת scope%'
         or name like 'בדיקת קליטה%'
         or phone_e164 like '+972599%'
   );

-- הלידים. crm_inquiries, crm_lead_notes ו-crm_lead_tasks מוגדרים
-- on delete cascade, כך שהם הולכים איתם.
delete from crm_leads
 where name like 'בדיקת scope%'
    or name like 'בדיקת קליטה%'
    or phone_e164 like '+972599%';

delete from crm_ads
 where facebook_ad_id in ('test-ad-001', 'unknown-ad-999');

delete from crm_intake_failures
 where source_ref like 'test-%';

-- הזמינות היא הגדרה ולא נתון בדיקה, ולכן מאפסים ולא מוחקים.
-- ⚠️ אחרי זה אף אחד לא זמין, וליד חדש ינותב למנהל המכירות.
update crm_rep_availability
   set is_active_today  = false,
       last_assigned_at = null,
       leads_today      = 0,
       leads_today_date = null,
       updated_at       = now();

commit;


-- ============================================================================
-- אימות
-- ============================================================================

select
  (select count(*) from crm_leads
    where name like 'בדיקת%' or phone_e164 like '+972599%')        as leftover_leads,
  (select count(*) from crm_ads
    where facebook_ad_id in ('test-ad-001','unknown-ad-999'))      as leftover_ads,
  (select count(*) from crm_intake_failures
    where source_ref like 'test-%')                                as leftover_failures,
  (select count(*) from crm_rep_availability
    where is_active_today)                                         as still_available,
  (select count(*) from crm_leads)                                 as total_leads,
  (select count(*) from crm_inquiries)                             as total_inquiries;
-- צפוי: ארבע העמודות הראשונות באפס.
-- total_leads ו-total_inquiries הם מה שנשאר במערכת — אמורים להיות 0
-- כל עוד לא נכנסו לידים אמיתיים.
