import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /whatsapp/stats ──────────────────────────────────────────────────────
router.get("/whatsapp/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [counters, avgScore] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE review_status = 'pending')::int  AS pending,
          COUNT(*) FILTER (WHERE review_status = 'reviewed')::int AS reviewed
        FROM whatsapp_messages
      `),
      db.execute(sql`
        SELECT ROUND(AVG(editor_score)::numeric, 1)::float AS avg_score
        FROM whatsapp_messages
        WHERE review_status = 'reviewed' AND editor_score IS NOT NULL
      `),
    ]);
    const c = counters.rows[0] as Record<string, number>;
    const a = avgScore.rows[0] as Record<string, number | null>;
    res.json({
      pending:   c["pending"]   ?? 0,
      reviewed:  c["reviewed"]  ?? 0,
      avg_score: a["avg_score"] ?? null,
    });
  } catch (err) {
    logger.error({ err }, "whatsapp/stats failed");
    res.status(500).json({ error: "שגיאה בטעינת סטטיסטיקות" });
  }
});

// ── GET /whatsapp/categories ─────────────────────────────────────────────────
router.get("/whatsapp/categories", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT category FROM whatsapp_messages
      WHERE category IS NOT NULL ORDER BY category
    `);
    res.json((rows.rows as Array<{ category: string }>).map((r) => r.category));
  } catch (err) {
    logger.error({ err }, "whatsapp/categories failed");
    res.status(500).json({ error: "שגיאה בטעינת קטגוריות" });
  }
});

// ── GET /whatsapp/conversations ──────────────────────────────────────────────
// Query params: filter=pending|all, category=<string>
router.get("/whatsapp/conversations", async (req: Request, res: Response): Promise<void> => {
  try {
    const filter   = (req.query["filter"]   as string | undefined) ?? "pending";
    const category = (req.query["category"] as string | undefined) ?? "";

    const rows = await db.execute(sql`
      SELECT
        customer_wa_id,
        MAX(customer_name)                                                          AS customer_name,
        MAX(message_text) KEEP (DENSE_RANK LAST ORDER BY received_at)              AS last_message,
        MAX(received_at)                                                            AS last_at,
        COUNT(*) FILTER (WHERE review_status = 'pending')::int                     AS pending_count,
        COUNT(*)::int                                                               AS total_count
      FROM whatsapp_messages
      WHERE
        (${filter} = 'all' OR review_status = 'pending')
        AND (${category} = '' OR category = ${category})
      GROUP BY customer_wa_id
      HAVING (${filter} = 'all' OR COUNT(*) FILTER (WHERE review_status = 'pending') > 0)
      ORDER BY MAX(received_at) DESC
    `);
    res.json(rows.rows);
  } catch (err) {
    // Fallback: some Postgres versions don't support KEEP … try simpler subquery
    logger.warn({ err }, "whatsapp conversations KEEP fallback triggered");
    try {
      const filter   = (req.query["filter"]   as string | undefined) ?? "pending";
      const category = (req.query["category"] as string | undefined) ?? "";

      const rows = await db.execute(sql`
        WITH ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY customer_wa_id ORDER BY received_at DESC) AS rn
          FROM whatsapp_messages
          WHERE
            (${filter} = 'all' OR review_status = 'pending')
            AND (${category} = '' OR category = ${category})
        ),
        last_msg AS (
          SELECT customer_wa_id, message_text AS last_message
          FROM ranked WHERE rn = 1
        ),
        agg AS (
          SELECT
            customer_wa_id,
            MAX(customer_name)                                                   AS customer_name,
            MAX(received_at)                                                     AS last_at,
            COUNT(*) FILTER (WHERE review_status = 'pending')::int               AS pending_count,
            COUNT(*)::int                                                         AS total_count
          FROM whatsapp_messages
          WHERE
            (${filter} = 'all' OR review_status = 'pending')
            AND (${category} = '' OR category = ${category})
          GROUP BY customer_wa_id
          HAVING (${filter} = 'all' OR COUNT(*) FILTER (WHERE review_status = 'pending') > 0)
        )
        SELECT a.*, l.last_message
        FROM agg a
        JOIN last_msg l ON l.customer_wa_id = a.customer_wa_id
        ORDER BY a.last_at DESC
      `);
      res.json(rows.rows);
    } catch (err2) {
      logger.error({ err: err2 }, "whatsapp conversations fallback failed");
      res.status(500).json({ error: "שגיאה בטעינת שיחות" });
    }
  }
});

// ── GET /whatsapp/conversations/:customer_wa_id ──────────────────────────────
router.get("/whatsapp/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const rows = await db.execute(sql`
      SELECT
        id, created_at, wa_message_id, received_at, customer_wa_id, customer_name,
        message_type, message_text, media_url,
        category, subcategory, intent, sentiment, urgency, language,
        ai_analysis, proposed_reply, ai_confidence, suggested_action,
        editor_score, editor_corrected_reply, editor_notes,
        review_status, reviewed_at
      FROM whatsapp_messages
      WHERE customer_wa_id = ${id}
      ORDER BY received_at ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    logger.error({ err }, "whatsapp conversation messages failed");
    res.status(500).json({ error: "שגיאה בטעינת הודעות" });
  }
});

// ── PATCH /whatsapp/messages/:id/review ─────────────────────────────────────
router.patch("/whatsapp/messages/:id/review", async (req: Request, res: Response): Promise<void> => {
  try {
    const msgId = Number(req.params["id"]);
    if (isNaN(msgId)) { res.status(400).json({ error: "id לא תקין" }); return; }

    const { editor_score, editor_corrected_reply, editor_notes } = req.body as {
      editor_score: number;
      editor_corrected_reply?: string;
      editor_notes?: string;
    };

    if (!editor_score || editor_score < 1 || editor_score > 5) {
      res.status(400).json({ error: "editor_score חייב להיות בין 1 ל-5" });
      return;
    }

    await db.execute(sql`
      UPDATE whatsapp_messages SET
        editor_score            = ${editor_score},
        editor_corrected_reply  = ${editor_corrected_reply?.trim() || null},
        editor_notes            = ${editor_notes?.trim() || null},
        review_status           = 'reviewed',
        reviewed_at             = NOW()
      WHERE id = ${msgId}
    `);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "whatsapp review save failed");
    res.status(500).json({ error: "שגיאה בשמירת הביקורת" });
  }
});

// ── GET /whatsapp/analytics ──────────────────────────────────────────────────
router.get("/whatsapp/analytics", async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Math.min(Number(req.query["days"] ?? 30), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [kpi, byCategory, scoreDist, byAction, byDay] = await Promise.all([
      // KPI + needs-attention
      db.execute(sql`
        SELECT
          COUNT(*)::int                                                           AS total_reviewed,
          ROUND(AVG(editor_score)::numeric,1)::float                             AS avg_score,
          ROUND(100.0 * COUNT(*) FILTER (
            WHERE editor_corrected_reply IS NULL OR TRIM(editor_corrected_reply)='' OR editor_corrected_reply = proposed_reply
          ) / NULLIF(COUNT(*),0), 1)::float                                      AS acceptance_rate,
          ROUND(AVG(
            CASE
              WHEN editor_corrected_reply IS NULL OR TRIM(editor_corrected_reply)='' THEN 1.0
              WHEN proposed_reply IS NULL OR proposed_reply = '' THEN 0.0
              ELSE 1.0 - CAST(
                levenshtein(
                  LEFT(proposed_reply,255),
                  LEFT(editor_corrected_reply,255)
                ) AS float
              ) / NULLIF(GREATEST(LENGTH(proposed_reply), LENGTH(editor_corrected_reply)),0)
            END
          )::numeric,3)::float                                                   AS avg_match
        FROM whatsapp_messages
        WHERE review_status='reviewed' AND received_at >= ${since}
      `),

      // Per-category
      db.execute(sql`
        SELECT
          COALESCE(category,'ללא קטגוריה')                                       AS category,
          COUNT(*)::int                                                           AS cnt,
          ROUND(AVG(editor_score)::numeric,2)::float                             AS avg_score,
          ROUND(AVG(ai_confidence)::numeric,1)::float                            AS avg_confidence,
          ROUND(100.0 * COUNT(*) FILTER (
            WHERE editor_corrected_reply IS NULL OR TRIM(editor_corrected_reply)='' OR editor_corrected_reply = proposed_reply
          ) / NULLIF(COUNT(*),0), 1)::float                                      AS acceptance_rate,
          ROUND(AVG(
            CASE
              WHEN editor_corrected_reply IS NULL OR TRIM(editor_corrected_reply)='' THEN 1.0
              WHEN proposed_reply IS NULL OR proposed_reply = '' THEN 0.0
              ELSE 1.0 - CAST(
                levenshtein(LEFT(proposed_reply,255),LEFT(editor_corrected_reply,255)) AS float
              ) / NULLIF(GREATEST(LENGTH(proposed_reply),LENGTH(editor_corrected_reply)),0)
            END
          )::numeric,3)::float                                                   AS avg_match
        FROM whatsapp_messages
        WHERE review_status='reviewed' AND received_at >= ${since}
        GROUP BY category
        ORDER BY avg_score ASC NULLS LAST
      `),

      // Score distribution
      db.execute(sql`
        SELECT editor_score::int AS score, COUNT(*)::int AS cnt
        FROM whatsapp_messages
        WHERE review_status='reviewed' AND editor_score IS NOT NULL AND received_at >= ${since}
        GROUP BY editor_score
        ORDER BY editor_score
      `),

      // By suggested_action
      db.execute(sql`
        SELECT
          COALESCE(suggested_action,'ללא')  AS action,
          COUNT(*)::int                     AS cnt,
          ROUND(AVG(editor_score)::numeric,2)::float AS avg_score
        FROM whatsapp_messages
        WHERE review_status='reviewed' AND received_at >= ${since}
        GROUP BY suggested_action
      `),

      // Trend by day
      db.execute(sql`
        SELECT
          DATE(received_at)::text               AS day,
          COUNT(*)::int                          AS cnt,
          ROUND(AVG(editor_score)::numeric,2)::float AS avg_score
        FROM whatsapp_messages
        WHERE review_status='reviewed' AND received_at >= ${since}
        GROUP BY DATE(received_at)
        ORDER BY day
      `),
    ]);

    // Confidence calibration — bucket manually
    const confRows = await db.execute(sql`
      SELECT
        CASE
          WHEN ai_confidence BETWEEN 0  AND 20  THEN '0–20'
          WHEN ai_confidence BETWEEN 21 AND 40  THEN '21–40'
          WHEN ai_confidence BETWEEN 41 AND 60  THEN '41–60'
          WHEN ai_confidence BETWEEN 61 AND 80  THEN '61–80'
          WHEN ai_confidence BETWEEN 81 AND 100 THEN '81–100'
          ELSE 'ללא'
        END                                          AS bucket,
        ROUND(AVG(editor_score)::numeric,2)::float   AS avg_score,
        COUNT(*)::int                                AS cnt
      FROM whatsapp_messages
      WHERE review_status='reviewed' AND ai_confidence IS NOT NULL AND received_at >= ${since}
      GROUP BY bucket
      ORDER BY MIN(ai_confidence)
    `);

    // Needs attention — 10 rows with lowest match score
    const attentionRows = await db.execute(sql`
      SELECT
        id, customer_name, category,
        proposed_reply, editor_corrected_reply,
        CASE
          WHEN editor_corrected_reply IS NULL OR TRIM(editor_corrected_reply)='' THEN 1.0
          WHEN proposed_reply IS NULL OR proposed_reply = '' THEN 0.0
          ELSE 1.0 - CAST(
            levenshtein(LEFT(proposed_reply,255),LEFT(editor_corrected_reply,255)) AS float
          ) / NULLIF(GREATEST(LENGTH(proposed_reply),LENGTH(editor_corrected_reply)),0)
        END AS match_score
      FROM whatsapp_messages
      WHERE review_status='reviewed'
        AND editor_corrected_reply IS NOT NULL
        AND TRIM(editor_corrected_reply) != ''
        AND received_at >= ${since}
      ORDER BY match_score ASC
      LIMIT 10
    `);

    res.json({
      kpi:          kpi.rows[0]         ?? {},
      by_category:  byCategory.rows     ?? [],
      score_dist:   scoreDist.rows      ?? [],
      by_action:    byAction.rows       ?? [],
      by_day:       byDay.rows          ?? [],
      conf_calib:   confRows.rows       ?? [],
      needs_attention: attentionRows.rows ?? [],
    });
  } catch (err) {
    logger.error({ err }, "whatsapp/analytics failed");
    res.status(500).json({ error: "שגיאה בטעינת אנליטיקה" });
  }
});

export default router;
