-- ============================================================================
-- 03_crm_ads.sql
-- מודול CRM · גל 1א · מודעות Facebook
--
-- אפיון 3.2 + 8.3: מודעות נמשכות אוטומטית מ-Facebook, On Demand בלבד —
-- ברגע שנכנס ליד ממודעה שאינה מוכרת. אין סנכרון מתוזמן.
-- הקמפיינר מוסיף מודעות בקצב שלו ושום דבר לא נשבר: מודעה חדשה נכנסת
-- כ"לא מקושרת", והליד ממנה נקלט כרגיל.
-- ============================================================================

begin;

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

commit;

-- ============================================================================
-- בדיקות
-- ============================================================================

-- 1. מודעה נכנסת ללא משפך — המצב הרגיל של מודעה חדשה מהקמפיינר
insert into crm_ads (facebook_ad_id, name) values ('TEST_AD_1', 'מודעת בדיקה');

-- 2. אותו מזהה שוב → אמור להיכשל על unique (זו ההגנה מפני כפילות בסנכרון)
--    להריץ בנפרד ולוודא שגיאה:
-- insert into crm_ads (facebook_ad_id, name) values ('TEST_AD_1', 'כפילות');

-- צפוי: שורה אחת, funnel_id = null
select facebook_ad_id, name, funnel_id, fetch_failed from crm_ads where facebook_ad_id = 'TEST_AD_1';

-- 3. שאילתת "לא מקושרות" — זו שה-n8n יריץ יומית
select count(*) as unlinked_count from crm_ads where funnel_id is null;

-- ניקוי
delete from crm_ads where facebook_ad_id = 'TEST_AD_1';
