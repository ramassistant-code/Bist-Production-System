-- 01_first_salesperson_id.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- customers.first_salesperson_id — "איש המכירות הראשון שסגר את הלקוח".
--
-- כלל עסקי (03/09/2026):
--   • על כל לקוח נשמר איש המכירות הראשון שסגר אותו. נקבע פעם אחת — בעת פתיחת
--     העסקה הראשונה של הלקוח — ולא נדרס אחר כך.
--   • איש המכירות שמבצע כל עסקה ממשיך להישמר על העסקה (deals.salesperson_id).
--   • לקוחות קיימים (כל מי שכבר במערכת בזמן ההרצה) → רם.
--
-- מה עושה הקובץ:
--   1. מוסיף את העמודה + FK ל-app_users + אינדקס.
--   2. מילוי רטרואקטיבי: כל לקוח בלי ערך → רם (מזוהה לפי שם, לא לפי uuid,
--      כי ה-uuid שונה בין dev ל-prod). ההרצה נעצרת אם אין בדיוק התאמה אחת.
--
-- להריץ ב-Supabase SQL Editor — קודם dev, אחר כך production.
-- **חובה להריץ לפני פריסת הקוד**: Drizzle מרחיב כל SELECT לרשימת עמודות
-- מפורשת, כך שקוד שמכיר את העמודה מול DB שלא מכיר אותה מפיל את כל מסך הלקוחות.
--
-- אידמפוטנטי: אפשר להריץ שוב בבטחה (IF NOT EXISTS + WHERE ... IS NULL).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. עמודה
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS first_salesperson_id uuid;

COMMENT ON COLUMN public.customers.first_salesperson_id IS
  'איש המכירות הראשון שסגר את הלקוח (app_users.id). נקבע פעם אחת בעסקה הראשונה ולא נדרס. הסנכרון ל-Monday: עמודת הסטטוס "איש-מכירות-ראשון" בלוח הלקוחות.';

-- 2. FK — אם איש המכירות יימחק (hard delete, לא קורה בפועל — המערכת עושה soft delete) הערך יתאפס
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_first_salesperson_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_first_salesperson_id_fkey
      FOREIGN KEY (first_salesperson_id) REFERENCES public.app_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. אינדקס (לדוחות "כמה לקוחות סגר כל איש מכירות")
CREATE INDEX IF NOT EXISTS customers_first_salesperson_id_idx
  ON public.customers (first_salesperson_id)
  WHERE first_salesperson_id IS NOT NULL;

-- 4. מילוי רטרואקטיבי — כל הלקוחות הקיימים → רם
--    מזהים את רם לפי שם מלא. אם השם בסביבה הזו שונה (למשל "רם עמדי בדיקות"),
--    לעדכן את RAM_FULL_NAME כאן לפני ההרצה.
DO $$
DECLARE
  RAM_FULL_NAME constant text := 'רם עמדי';
  ram_id   uuid;
  matches  integer;
  updated  integer;
BEGIN
  -- (אין min() ל-uuid ב-Postgres — קודם סופרים, ואז שולפים את השורה היחידה)
  SELECT count(*)
    INTO matches
    FROM public.app_users
   WHERE full_name = RAM_FULL_NAME
     AND deleted_at IS NULL;

  IF matches <> 1 THEN
    RAISE EXCEPTION
      'backfill aborted: expected exactly one app_users row named "%", found % — fix RAM_FULL_NAME and re-run',
      RAM_FULL_NAME, matches;
  END IF;

  SELECT id
    INTO ram_id
    FROM public.app_users
   WHERE full_name = RAM_FULL_NAME
     AND deleted_at IS NULL;

  -- בכוונה לא נוגעים ב-updated_at: זה מילוי היסטורי, לא עריכה של הלקוח.
  UPDATE public.customers
     SET first_salesperson_id = ram_id
   WHERE first_salesperson_id IS NULL;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RAISE NOTICE 'first_salesperson_id backfilled to % (%) on % customers', RAM_FULL_NAME, ram_id, updated;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- בדיקות (אחרי ה-COMMIT — להריץ ולקרוא את הפלט)
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 העמודה קיימת עם הטיפוס הנכון
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'customers'
   AND column_name = 'first_salesperson_id';

-- 4.2 ה-FK קיים
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'customers_first_salesperson_id_fkey';

-- 4.3 אף לקוח פעיל בלי איש מכירות ראשון (מצופה: 0)
SELECT count(*) AS active_customers_without_first_salesperson
  FROM public.customers
 WHERE deleted_at IS NULL AND first_salesperson_id IS NULL;

-- 4.4 התפלגות — כרגע הכול אצל רם; מכאן והלאה יתווספו אנשי מכירות אחרים
SELECT u.full_name, count(c.id) AS customers
  FROM public.customers c
  LEFT JOIN public.app_users u ON u.id = c.first_salesperson_id
 WHERE c.deleted_at IS NULL
 GROUP BY u.full_name
 ORDER BY customers DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (רק אם צריך לבטל הכול)
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE public.customers DROP COLUMN IF EXISTS first_salesperson_id;
