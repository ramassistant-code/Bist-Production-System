-- ============================================================================
-- 90_dev_scope_test_seed.sql
-- מודול CRM · לידי בדיקה לאימות הרשאות הצפייה (גל 2א)
--
-- ⚠️ סביבת פיתוח בלבד. לא להריץ בייצור.
--
-- מטרה: להוכיח בזמן ריצה — לא בקריאת קוד — שאיש מכירות ששולח ?view=manager
--        בכוונה עדיין רואה רק את הלידים שלו.
--
-- להריץ קטע-קטע. שלב 0 נותן לך את שני ה-UUID שצריך להדביק בשלב 1.
-- ============================================================================


-- ── שלב 0: מי המשתמשים ─────────────────────────────────────────────────────
-- בחר משתמש אחד בתפקיד sales (איתו תתחבר ותבדוק) ומשתמש שני כלשהו.
select id, full_name, email, role, is_active
  from app_users
 where deleted_at is null
 order by role, full_name;


-- ── שלב 1: הזרעה ────────────────────────────────────────────────────────────
-- החלף את שני ה-UUID למטה בערכים משלב 0, ואז הרץ.
-- SALES_REP  = המשתמש שאיתו תתחבר לבדיקה (תפקיד sales)
-- OTHER_REP  = משתמש אחר. הלידים שלו הם אלה שאסור שיראה.

begin;

-- ⚠️ החלף את שני ה-UUID בשורות שמסומנות ← לפני ההרצה.
insert into crm_leads (name, phone_e164, phone_raw, sales_rep_id, status_code, source)
values
  ('בדיקת scope — שלי 1',    '+972500000001', '0500000001',
   '00000000-0000-0000-0000-000000000000'::uuid, 'new',       'manual'),  -- ← SALES_REP
  ('בדיקת scope — שלי 2',    '+972500000002', '0500000002',
   '00000000-0000-0000-0000-000000000000'::uuid, 'no_answer', 'manual'),  -- ← SALES_REP
  ('בדיקת scope — שלי 3',    '+972500000003', '0500000003',
   '00000000-0000-0000-0000-000000000000'::uuid, 'pipe',      'manual'),  -- ← SALES_REP
  ('בדיקת scope — של אחר 1', '+972500000101', '0500000101',
   '11111111-1111-1111-1111-111111111111'::uuid, 'new',       'manual'),  -- ← OTHER_REP
  ('בדיקת scope — של אחר 2', '+972500000102', '0500000102',
   '11111111-1111-1111-1111-111111111111'::uuid, 'no_answer', 'manual'),  -- ← OTHER_REP
  ('בדיקת scope — של אחר 3', '+972500000103', '0500000103',
   '11111111-1111-1111-1111-111111111111'::uuid, 'pipe',      'manual'),  -- ← OTHER_REP
  ('בדיקת scope — ללא שיוך', '+972500000201', '0500000201',
   null,                                         'new',       'manual')
on conflict (phone_e164) do nothing;

commit;

-- אימות ההזרעה: צפוי 3 / 3 / 1
select coalesce(u.full_name, '(ללא שיוך)') as rep, count(*) as leads
  from crm_leads l
  left join app_users u on u.id = l.sales_rep_id
 where l.name like 'בדיקת scope%'
 group by 1 order by 1;


-- ── שלב 1ב: זריעת תור הזמינות ───────────────────────────────────────────────
-- נדרש כדי ש-crm_next_rep_in_queue() יחזיר מישהו. בלי זה כל ליד נכנס
-- נופל למנהל המכירות, וזה נראה כמו באג ברוטציה.
-- ⚠️ החלף את שלושת ה-UUID במשתמשים אמיתיים בתפקיד sales.

update crm_rep_availability set is_active_today = false;

insert into crm_rep_availability (user_id, is_active_today, queue_position)
values
  ('00000000-0000-0000-0000-000000000000'::uuid, true, 1),   -- ← נציג 1
  ('00000000-0000-0000-0000-000000000000'::uuid, true, 2),   -- ← נציג 2
  ('00000000-0000-0000-0000-000000000000'::uuid, true, 3)    -- ← נציג 3
on conflict (user_id) do update
   set is_active_today  = true,
       queue_position   = excluded.queue_position,
       last_assigned_at = null,
       leads_today      = 0,
       leads_today_date = null;

-- צפוי: שלוש שורות
select user_id, queue_position from crm_rep_availability where is_active_today;


-- ── שלב 1ג: לידים דרך מסלול הקליטה האמיתי ───────────────────────────────────
-- את לידי הקליטה אי אפשר לזרוע ב-SQL — הם חייבים לעבור דרך
-- POST /api/crm/webhooks/lead, אחרת לא נבדקים ה-dedup, ירושת המשפך
-- והרוטציה. ה-snippet לירי דרך ה-Console נמצא בשיחת גל 4א; הוא שולח
-- שישה לידים תקינים, כפילות, טלפון פסול וליד בלי שם.
-- דורש CRM_INTAKE_SECRET מוגדר ב-Replit Secrets.


-- ============================================================================
-- שלב 2: הבדיקה עצמה — לא ב-SQL אלא מול ה-API
-- ============================================================================
--
-- 1. להתחבר למערכת כמשתמש SALES_REP
-- 2. ב-DevTools ← Console:
--       (await supabase.auth.getSession()).data.session.access_token
-- 3. להריץ את שלוש הקריאות. התוצאה הקובעת היא הראשונה.
--
--    א. איש מכירות שמנסה מצב מנהל — חייב לקבל רק את שלושת שלו:
--       curl -H "Authorization: Bearer <TOKEN_SALES>" \
--         "https://<host>/api/crm/leads?view=manager"
--       ❌ אם מופיע "בדיקת scope — של אחר" — נקודת האכיפה דולפת, לעצור הכול.
--
--    ב. בלי token — חייב 401:
--       curl -i "https://<host>/api/crm/leads"
--
--    ג. אדמין עם view=manager — חייב לראות את כל השבעה:
--       curl -H "Authorization: Bearer <TOKEN_ADMIN>" \
--         "https://<host>/api/crm/leads?view=manager"
--
--    ד. איש מכירות מנסה לפתוח ליד של אחר לפי id — חייב 404, לא 403:
--       curl -i -H "Authorization: Bearer <TOKEN_SALES>" \
--         "https://<host>/api/crm/leads/<id של 'בדיקת scope — של אחר 1'>"
--
-- ============================================================================


-- ── ניקוי ───────────────────────────────────────────────────────────────────
-- לא כאן. 91_dev_test_data_cleanup.sql מוחק את כל נתוני הבדיקה של גלים 2–4
-- במקום אחד, כולל לידי הקליטה, המודעות ויומן הביקורת.
