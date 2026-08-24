-- ============================================================================
-- 09_role_enum_usage.sql
-- אילו עמודות במערכת משתמשות ב-enum user_role?
--
-- חשוב לגל 1ב: הריפו ממפה את app_users.role כ-text ב-Drizzle, בעוד שב-DB
-- הוא enum. אם יש עוד עמודות כאלה, כדאי לדעת עליהן לפני המירור.
-- ============================================================================

select c.table_schema,
       c.table_name,
       c.column_name,
       c.udt_name        as db_type,
       c.is_nullable
  from information_schema.columns c
 where c.udt_name = 'user_role'
 order by c.table_schema, c.table_name, c.column_name;
