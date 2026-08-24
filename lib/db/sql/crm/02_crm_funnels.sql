-- ============================================================================
-- 02_crm_funnels.sql
-- מודול CRM · גל 1א · משפכים שיווקיים + היסטוריית עלות לליד
--
-- דרישה מרכזית (אפיון 3.1): שדה העלות לעולם אינו נדרס. בכל עדכון נסגרת
-- התקופה הקודמת ונפתחת חדשה, כדי שנוכל לחשב עלות רכישת לקוח מדויקת
-- לפי התקופה שבה הליד באמת נכנס.
--
-- המימוש: טריגר ב-DB. כך שגם עדכון ידני דרך Supabase Studio מתועד,
-- ולא רק עדכון שעבר דרך האפליקציה.
-- ============================================================================

begin;

-- ── משפכים ──────────────────────────────────────────────────────────────────
create table if not exists crm_funnels (
  id                    uuid primary key default gen_random_uuid(),
  name                  text        not null unique,
  current_cost_per_lead numeric(12,2),
  cost_updated_at       timestamptz,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table  crm_funnels is 'משפך שיווקי. נוצר ומנוהל ידנית על ידי אדמין בלבד — לעולם לא אוטומטית';
comment on column crm_funnels.current_cost_per_lead is 'עלות לליד נוכחית בשקלים. מוזן ידנית, בדרך כלל בתחילת חודש';
comment on column crm_funnels.is_active is 'משפך לא פעיל אינו מקבל לידים חדשים אך נשמר להיסטוריה';

-- ── היסטוריית עלות ──────────────────────────────────────────────────────────
create table if not exists crm_funnel_cost_history (
  id            uuid primary key default gen_random_uuid(),
  funnel_id     uuid        not null references crm_funnels(id) on delete cascade,
  cost_per_lead numeric(12,2) not null,
  valid_from    date        not null default current_date,
  valid_to      date,
  updated_by    uuid        references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint crm_funnel_cost_history_range_valid
    check (valid_to is null or valid_to >= valid_from)
);

comment on table  crm_funnel_cost_history is 'תקופות תוקף של עלות לליד. valid_to ריק = התקופה הפעילה';
comment on column crm_funnel_cost_history.valid_to is 'ריק = זו הרשומה הפעילה כרגע';

create index if not exists crm_funnel_cost_history_funnel_idx
  on crm_funnel_cost_history (funnel_id, valid_from desc);

-- תקופה פתוחה אחת בלבד לכל משפך
create unique index if not exists crm_funnel_cost_history_one_open_idx
  on crm_funnel_cost_history (funnel_id)
  where valid_to is null;

-- ── טריגרים: תיעוד עלות ─────────────────────────────────────────────────────
-- מפוצל לשניים בכוונה:
--   BEFORE  — חותם תאריכים על השורה עצמה (אפשר לגעת ב-NEW)
--   AFTER   — כותב להיסטוריה (שורת המשפך כבר קיימת, כך שה-FK תקף)
-- ⚠️ אסור לכתוב להיסטוריה ב-BEFORE INSERT: שורת המשפך עדיין לא קיימת
--    וה-FK ל-crm_funnels ייכשל.

create or replace function crm_funnel_cost_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.current_cost_per_lead is not null
     and (tg_op = 'INSERT'
          or old.current_cost_per_lead is distinct from new.current_cost_per_lead) then
    new.cost_updated_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function crm_funnel_cost_track()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  if new.current_cost_per_lead is null then
    return null;
  end if;

  -- בעדכון: לתעד רק אם העלות באמת השתנתה
  if tg_op = 'UPDATE'
     and old.current_cost_per_lead is not distinct from new.current_cost_per_lead then
    return null;
  end if;

  -- מזהה המשתמש מגיע מהאפליקציה כ-SET LOCAL crm.actor_id = '<uuid>'.
  -- אם לא הוגדר (עדכון ידני ב-Studio) — נשמר null.
  begin
    v_actor := nullif(current_setting('crm.actor_id', true), '')::uuid;
  exception when others then
    v_actor := null;
  end;

  -- סגירת התקופה הפעילה
  update crm_funnel_cost_history
     set valid_to = current_date
   where funnel_id = new.id
     and valid_to is null;

  -- פתיחת תקופה חדשה
  insert into crm_funnel_cost_history (funnel_id, cost_per_lead, valid_from, updated_by)
  values (new.id, new.current_cost_per_lead, current_date, v_actor);

  return null;
end;
$$;

drop trigger if exists crm_funnels_cost_stamp on crm_funnels;
create trigger crm_funnels_cost_stamp
  before insert or update of current_cost_per_lead on crm_funnels
  for each row
  execute function crm_funnel_cost_stamp();

drop trigger if exists crm_funnels_cost_track on crm_funnels;
create trigger crm_funnels_cost_track
  after insert or update of current_cost_per_lead on crm_funnels
  for each row
  execute function crm_funnel_cost_track();

commit;

-- ============================================================================
-- בדיקות
-- ============================================================================

-- 1. יצירת משפך עם עלות → נפתחת תקופה ראשונה
insert into crm_funnels (name, current_cost_per_lead) values ('בדיקה — למחיקה', 42.00);

-- צפוי: שורה אחת, valid_to = null
select f.name, h.cost_per_lead, h.valid_from, h.valid_to
  from crm_funnel_cost_history h
  join crm_funnels f on f.id = h.funnel_id
 where f.name = 'בדיקה — למחיקה';

-- 2. עדכון עלות → הקודמת נסגרת, נפתחת חדשה
update crm_funnels set current_cost_per_lead = 55.00 where name = 'בדיקה — למחיקה';

-- צפוי: שתי שורות. הישנה עם valid_to = היום, החדשה עם valid_to = null
select h.cost_per_lead, h.valid_from, h.valid_to
  from crm_funnel_cost_history h
  join crm_funnels f on f.id = h.funnel_id
 where f.name = 'בדיקה — למחיקה'
 order by h.valid_from, h.created_at;

-- 3. עדכון לאותו ערך → לא נוצרת שורה נוספת
update crm_funnels set current_cost_per_lead = 55.00 where name = 'בדיקה — למחיקה';

-- צפוי: עדיין שתי שורות בלבד
select count(*) as history_rows
  from crm_funnel_cost_history h
  join crm_funnels f on f.id = h.funnel_id
 where f.name = 'בדיקה — למחיקה';

-- ניקוי
delete from crm_funnels where name = 'בדיקה — למחיקה';
