-- ============================================================================
-- 12_crm_ads_fetch_failed_meaning.sql
-- מודול CRM · תיקון המשמעות של crm_ads.fetch_failed, ואיפוס דגלים שגויים
--
-- הרקע: התיעוד המקורי אמר "המשיכה מ-Facebook נכשלה ונוצרה רשומה חלקית".
-- בפועל ה-CRM אינו פונה לפייסבוק בכלל — אין בקוד שום קריאה ל-Graph API,
-- ואין טוקן. הדגל נכתב כליטרל true על כל מודעה חדשה, ולכן כל שורה במסך
-- המודעות הוצגה עם תג אדום "שגיאת סנכרון" על תקלה שלא קרתה.
--
-- מה שבאמת קורה: n8n מביא ad_name, campaign_id, campaign_name, adset_id
-- ו-adset_name מתוך ה-payload של הליד. רשומה עם שם היא שלמה לכל צורך
-- מעשי; היחיד שחסר הוא ad_url, שימולא בגל 6.
--
-- מכאן והלאה: fetch_failed = "רשומה חלקית שדורשת השלמה", ונדלק רק כשאין
-- שם מודעה. ingestLead כבר תוקן בהתאם.
--
-- ⚠️ תוספתי בלבד. שום עמודה לא נוספת ולא משתנה.
-- ============================================================================

begin;

comment on column crm_ads.fetch_failed is
  'true = רשומה חלקית שחסר בה שם המודעה ודורשת השלמה. אינו מעיד על ניסיון משיכה שנכשל — ה-CRM אינו פונה ל-Facebook';

-- איפוס דגלים שנדלקו בטעות: מודעות שיש בהן שם אינן חלקיות.
update crm_ads
   set fetch_failed = false,
       updated_at   = now()
 where fetch_failed = true
   and name is not null
   and btrim(name) <> '';

commit;

-- ============================================================================
-- אימות
-- ============================================================================

select
  count(*)                                                   as ads,
  count(*) filter (where fetch_failed)                       as flagged,
  count(*) filter (where fetch_failed and name is not null)  as flagged_with_name,
  count(*) filter (where ad_url is null)                     as without_url
  from crm_ads;
-- צפוי: flagged_with_name = 0.
-- flagged יישאר גדול מאפס רק אם יש מודעות שהגיעו באמת בלי שם.
-- without_url יהיה שווה למספר המודעות — זה תקין עד גל 6.
