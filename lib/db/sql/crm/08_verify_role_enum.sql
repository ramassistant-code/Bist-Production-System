-- ============================================================================
-- 08_verify_role_enum.sql
-- אימות אחרי 07. להריץ בהרצה נפרדת — לא באותה הרצה של ה-ALTER TYPE.
-- ============================================================================

-- 1. הערכים ב-enum. צפוי: 7, ו-sales_manager מופיע מיד אחרי sales
select e.enumsortorder as ord,
       e.enumlabel::text as role_value,
       case when e.enumlabel::text = 'sales_manager' then '← חדש' else '' end as note
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
 where t.typname = 'user_role'
 order by e.enumsortorder;
