-- ============================================================================
-- 99_rollback.sql
-- מודול CRM · ביטול מלא של גל 1א
--
-- ⚠️ מוחק את כל נתוני ה-CRM. להריץ רק אם רוצים לחזור למצב שלפני הגל.
--
-- בטוח להרצה כל עוד לא בוצעה הקשירה (גל 7ב): כל הטבלאות מבודדות,
-- ואף טבלה קיימת אינה מצביעה עליהן. אחרי הקשירה — לא להריץ.
-- ============================================================================

begin;

-- סדר המחיקה לפי תלויות
drop table if exists crm_audit_log           cascade;
drop table if exists crm_rep_availability    cascade;
drop table if exists crm_call_logs           cascade;
drop table if exists crm_lead_tasks          cascade;
drop table if exists crm_lead_notes          cascade;
drop table if exists crm_inquiries           cascade;
drop table if exists crm_leads               cascade;
drop table if exists crm_ads                 cascade;
drop table if exists crm_funnel_cost_history cascade;
drop table if exists crm_funnels             cascade;
drop table if exists crm_lead_statuses       cascade;
drop table if exists crm_rejection_reasons   cascade;

drop function if exists crm_next_rep_in_queue()   cascade;
drop function if exists crm_task_stamp_completion() cascade;
drop function if exists crm_inquiry_set_number()  cascade;
drop function if exists crm_funnel_cost_track()   cascade;
drop function if exists crm_funnel_cost_stamp()   cascade;

commit;

-- ============================================================================
-- אימות
-- ============================================================================

select table_name
  from information_schema.tables
 where table_schema = 'public' and table_name like 'crm\_%';

-- צפוי: הטבלה הישנה שלמה ולא נגעה מעולם
select count(*) as lookup_rejection_reason_rows from lookup_rejection_reason;
