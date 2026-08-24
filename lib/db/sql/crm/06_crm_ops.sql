-- ============================================================================
-- 06_crm_ops.sql
-- מודול CRM · גל 1א · זמינות אנשי מכירות + יומן ביקורת
-- אפיון סעיפים 3.8, 5.2, 5.4, 10
-- ============================================================================

begin;

-- ── זמינות (3.8) ────────────────────────────────────────────────────────────
-- אין איפוס אוטומטי בסוף יום עסקים. הדגל נשאר עד לשינוי ידני של מנהל
-- המכירות (החלטה 8 באפיון).
create table if not exists crm_rep_availability (
  user_id          uuid primary key references app_users(id) on delete cascade,
  is_active_today  boolean     not null default false,
  queue_position   integer     not null default 0,

  -- בסיס הרוטציה: הבא בתור הוא הפעיל עם last_assigned_at הישן ביותר
  last_assigned_at timestamptz,
  leads_today      integer     not null default 0,
  leads_today_date date,

  updated_by       uuid        references app_users(id) on delete set null,
  updated_at       timestamptz not null default now()
);

comment on table  crm_rep_availability is 'זמינות יומית לחלוקת RoundRobin. אין איפוס אוטומטי';
-- user_id הוא ה-PK ולכן NOT NULL — ON DELETE SET NULL היה נכשל וחוסם מחיקת משתמש.
-- CASCADE מוחק רק את שורת הזמינות ומשאיר את מחיקת המשתמש לעבור חלק.
comment on column crm_rep_availability.user_id is 'PK. CASCADE במכוון — ראו ההערה מעל';
comment on column crm_rep_availability.last_assigned_at is 'בסיס הרוטציה — הבא בתור הוא הפעיל הוותיק ביותר';
comment on column crm_rep_availability.leads_today      is 'מונה תצוגה למסך הזמינות. מתאפס כש-leads_today_date אינו היום';

-- האינדקס שבחירת "הבא בתור" רצה עליו
create index if not exists crm_rep_availability_next_idx
  on crm_rep_availability (last_assigned_at nulls first, queue_position)
  where is_active_today = true;

-- ── יומן ביקורת (5.4, 10) ───────────────────────────────────────────────────
create table if not exists crm_audit_log (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text        not null,
  entity_id     uuid,
  action        text        not null,
  actor_user_id uuid        references app_users(id) on delete set null,
  details       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table  crm_audit_log is 'יומן ביקורת למודול ה-CRM: שינויי זמינות, העברות Bulk, שיוך מחדש';
comment on column crm_audit_log.action  is 'לדוגמה: availability_toggled, lead_reassigned, bulk_transfer, cost_updated';
comment on column crm_audit_log.details is 'לפני/אחרי, כמויות, ומי הועבר למי';

create index if not exists crm_audit_log_entity_idx
  on crm_audit_log (entity_type, entity_id, created_at desc);
create index if not exists crm_audit_log_actor_idx
  on crm_audit_log (actor_user_id, created_at desc);

-- ── בחירת הבא בתור (5.2) ───────────────────────────────────────────────────
-- פונקציה אחת שמרכזת את כלל ה-RoundRobin, עם נעילת שורה כדי ששתי קליטות
-- מקבילות לא יקבלו את אותו איש מכירות.
--
-- מחזירה NULL כשאף איש מכירות אינו פעיל — הקוד הקורא אחראי ליפול
-- למנהל המכירות (השורה הרביעית בטבלת 5.2).
create or replace function crm_next_rep_in_queue()
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  select a.user_id
    into v_user_id
    from crm_rep_availability a
    join app_users u on u.id = a.user_id
   where a.is_active_today = true
     and u.is_active = true
     and u.deleted_at is null
   order by a.last_assigned_at nulls first, a.queue_position, a.user_id
   for update of a skip locked
   limit 1;

  if v_user_id is null then
    return null;
  end if;

  update crm_rep_availability
     set last_assigned_at = now(),
         leads_today = case
           when leads_today_date = current_date then leads_today + 1
           else 1
         end,
         leads_today_date = current_date,
         updated_at = now()
   where user_id = v_user_id;

  return v_user_id;
end;
$$;

comment on function crm_next_rep_in_queue() is
  'מחזיר את איש המכירות הבא בתור ומעדכן את הרוטציה. NULL = אף אחד לא פעיל';

commit;

-- ============================================================================
-- בדיקות
-- ============================================================================

-- 1. אף אחד לא פעיל → NULL (הליד אמור ללכת למנהל המכירות)
-- צפוי: null
select crm_next_rep_in_queue() as should_be_null;

-- 2. להפעיל שני אנשי מכירות אמיתיים.
--    ⚠️ להחליף את שתי כתובות המייל בכתובות אמיתיות מהמערכת שלך.
insert into crm_rep_availability (user_id, is_active_today, queue_position)
select id, true, 1 from app_users where email = 'rep1@example.com'
on conflict (user_id) do update set is_active_today = true;

insert into crm_rep_availability (user_id, is_active_today, queue_position)
select id, true, 2 from app_users where email = 'rep2@example.com'
on conflict (user_id) do update set is_active_today = true;

-- 3. ארבע קריאות ברצף → צפוי סבב: א, ב, א, ב
select crm_next_rep_in_queue() as pick_1;
select crm_next_rep_in_queue() as pick_2;
select crm_next_rep_in_queue() as pick_3;
select crm_next_rep_in_queue() as pick_4;

-- 4. תמונת מצב — צפוי 2 לכל אחד
select u.full_name, a.is_active_today, a.leads_today, a.last_assigned_at
  from crm_rep_availability a
  join app_users u on u.id = a.user_id
 order by a.last_assigned_at;

-- ניקוי מוני הבדיקה (משאיר את השורות, מאפס את הספירה)
update crm_rep_availability
   set is_active_today = false, leads_today = 0,
       leads_today_date = null, last_assigned_at = null;
