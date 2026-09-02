-- ============================================================================
-- 13_crm_inquiries_funnel_lock.sql
-- מודול CRM · הגנה על שיוך משפך שנקבע ידנית
--
-- הרקע: ל-crm_inquiries.funnel_id יש עכשיו שני מקורות.
--   אוטומטי — נגזר מ-crm_ads.funnel_id בזמן הקליטה.
--   ידני     — מנהל משנה אותו דרך PATCH /api/crm/leads/:id/funnel.
--
-- האפיון מגדיר גם מילוי רטרואקטיבי: כשמודעה מקושרת למשפך, הפניות
-- הישנות שלה מתעדכנות. בלי סימון, המילוי הזה ידרוס בשקט כל תיקון ידני —
-- מנהל יתקן שיוך, וכעבור יום הוא יחזור בלי שאיש יבין למה.
--
-- הפתרון: חותמת נעילה. מי שקובע ידנית מסמן, וכל מילוי אוטומטי — קיים או
-- עתידי, באפליקציה או ב-n8n — חייב לדלג על שורות מסומנות.
--
-- ⚠️ תוספתי. אף עמודה קיימת לא משתנה.
-- ============================================================================

begin;

alter table crm_inquiries
  add column if not exists funnel_locked_at timestamptz,
  add column if not exists funnel_locked_by uuid
    references app_users(id) on delete set null;

comment on column crm_inquiries.funnel_locked_at is
  'מלא = המשפך נקבע ידנית ואין לדרוס אותו במילוי אוטומטי. ריק = נגזר מהמודעה';
comment on column crm_inquiries.funnel_locked_by is
  'מי קבע. FK עם ON DELETE SET NULL — מחיקת משתמש לא מבטלת את הנעילה עצמה';

-- אינדקס חלקי: המילוי הרטרואקטיבי שואל "מי לא נעול", והנעולות הן המיעוט
create index if not exists crm_inquiries_funnel_locked_idx
  on crm_inquiries (funnel_locked_at)
  where funnel_locked_at is not null;

commit;

-- ============================================================================
-- הכלל למי שכותב מילוי רטרואקטיבי
-- ============================================================================
--
-- כל עדכון המוני של crm_inquiries.funnel_id חייב לשאת את התנאי הזה:
--
--   update crm_inquiries
--      set funnel_id = $funnel_id
--    where ad_id = $ad_id
--      and funnel_locked_at is null;   -- ← בלי זה, תיקונים ידניים נמחקים
--
-- זה נכון גם למילוי מהאפליקציה וגם לכל workflow ב-n8n שניגש ל-DB ישירות.

-- ============================================================================
-- אימות
-- ============================================================================

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'crm_inquiries'
   and column_name in ('funnel_locked_at', 'funnel_locked_by')
 order by column_name;
-- צפוי: שתי שורות, שתיהן nullable

select count(*)                                          as inquiries,
       count(*) filter (where funnel_locked_at is not null) as locked
  from crm_inquiries;
-- צפוי: locked = 0. שום שיוך קיים לא הוגדר ידנית עד עכשיו.
