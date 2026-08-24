-- ============================================================================
-- 04_crm_leads.sql
-- מודול CRM · גל 1א · לידים ופניות — ליבת המודול
--
-- ההחלטה המרכזית באפיון (סעיף 3): הפרדה בין האדם לבין האירוע.
--   crm_leads     — רשומה אחת לאדם אחד. המפתח הייחודי הוא הטלפון.
--   crm_inquiries — רשומה לכל פעם שהאדם השאיר פרטים. ליד אחד → הרבה פניות.
--
-- ⚠️ עקרון הבידוד: שום FK של ה-CRM אינו חוסם ואינו משנה נתונים בטבלה קיימת.
--    עמודה nullable  → ON DELETE SET NULL
--    עמודה שהיא PK   → ON DELETE CASCADE (מוחק רק את שורת ה-CRM)
--    בשני המקרים מחיקה בטבלה ישנה עוברת חלק.
--    שום עמודה לא נוספת לטבלאות הקיימות — הקישור נשמר כאן בלבד.
-- ============================================================================

begin;

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

commit;

-- ============================================================================
-- בדיקות
-- ============================================================================

-- 1. יצירת ליד
insert into crm_leads (name, phone_e164, phone_raw)
values ('בדיקה — למחיקה', '+972500000001', '050-000-0001');

-- 2. טלפון כפול → אמור להיכשל על unique. להריץ בנפרד ולוודא שגיאה:
-- insert into crm_leads (name, phone_e164) values ('כפילות', '+972500000001');

-- 3. פורמט טלפון לא תקין → אמור להיכשל על ה-CHECK. להריץ בנפרד:
-- insert into crm_leads (name, phone_e164) values ('פורמט שגוי', '0501234567');

-- 4. סטטוס ברירת מחדל
-- צפוי: new
select name, status_code, capture_attempts, is_active_customer
  from crm_leads where phone_e164 = '+972500000001';

-- 5. שתי פניות לאותו ליד → מספור 1 ואז 2
insert into crm_inquiries (lead_id, form_name, raw_payload)
select id, 'טופס א', '{"test":1}'::jsonb from crm_leads where phone_e164 = '+972500000001';

insert into crm_inquiries (lead_id, form_name, raw_payload)
select id, 'טופס ב', '{"test":2}'::jsonb from crm_leads where phone_e164 = '+972500000001';

-- צפוי: שתי שורות עם inquiry_number 1 ו-2
select i.inquiry_number, i.form_name, i.inquiry_at
  from crm_inquiries i
  join crm_leads l on l.id = i.lead_id
 where l.phone_e164 = '+972500000001'
 order by i.inquiry_number;

-- 6. סיבת דחייה לא קיימת → אמור להיכשל על ה-FK. להריץ בנפרד:
-- update crm_leads set rejection_reason_code = 'bogus' where phone_e164 = '+972500000001';

-- 7. סיבת דחייה תקינה → עובר
update crm_leads set status_code = 'not_relevant', rejection_reason_code = 'price'
 where phone_e164 = '+972500000001';

-- צפוי: not_relevant / price / requires_detail = false
select l.status_code, l.rejection_reason_code, r.label, r.requires_detail
  from crm_leads l
  join crm_rejection_reasons r on r.code = l.rejection_reason_code
 where l.phone_e164 = '+972500000001';

-- 8. סטטוס לא קיים → אמור להיכשל על ה-FK. להריץ בנפרד:
-- update crm_leads set status_code = 'bogus' where phone_e164 = '+972500000001';

-- ניקוי (ה-CASCADE ימחק גם את הפניות)
delete from crm_leads where phone_e164 = '+972500000001';
