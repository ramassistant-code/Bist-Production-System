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

// ── Levenshtein similarity (JS, no DB extension needed) ──────────────────────
function levenshteinSim(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const s1 = a.slice(0, 400);
  const s2 = b.slice(0, 400);
  if (s1 === s2) return 1;
  const m = s1.length, n = s2.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = s1[i - 1] === s2[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

function matchScore(proposed: string | null, corrected: string | null): number {
  const c = corrected?.trim() ?? "";
  const p = proposed?.trim() ?? "";
  if (!c) return 1.0;           // editor kept AI reply as-is
  if (!p) return 0.0;
  return levenshteinSim(p, c);
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round(v: number | null, decimals = 2): number | null {
  if (v == null) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// ── GET /whatsapp/analytics ──────────────────────────────────────────────────
router.get("/whatsapp/analytics", async (req: Request, res: Response): Promise<void> => {
  try {
    const days = Math.min(Number(req.query["days"] ?? 30), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all reviewed rows in one query; aggregate in JS
    const raw = await db.execute(sql`
      SELECT
        id, customer_name, category, subcategory, suggested_action,
        ai_confidence, editor_score,
        proposed_reply, editor_corrected_reply,
        DATE(received_at)::text AS day
      FROM whatsapp_messages
      WHERE review_status = 'reviewed' AND received_at >= ${since}
    `);

    type Row = {
      id: number;
      customer_name: string | null;
      category: string | null;
      suggested_action: string | null;
      ai_confidence: number | null;
      editor_score: number | null;
      proposed_reply: string | null;
      editor_corrected_reply: string | null;
      day: string | null;
      _match: number;
    };

    const rows: Row[] = (raw.rows as Omit<Row, "_match">[]).map((r) => ({
      ...r,
      _match: matchScore(r.proposed_reply, r.editor_corrected_reply),
    }));

    // ── KPI ────────────────────────────────────────────────────────────────
    const matches   = rows.map((r) => r._match);
    const accepted  = rows.filter((r) => r._match >= 0.9).length;
    const scores    = rows.map((r) => r.editor_score).filter((s): s is number => s != null);
    const kpi = {
      total_reviewed:  rows.length,
      avg_score:       round(avg(scores), 1),
      acceptance_rate: round(rows.length ? (accepted / rows.length) * 100 : null, 1),
      avg_match:       round(avg(matches), 3),
    };

    // ── Per-category ───────────────────────────────────────────────────────
    const catMap = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.category ?? "ללא קטגוריה";
      if (!catMap.has(k)) catMap.set(k, []);
      catMap.get(k)!.push(r);
    }
    const by_category = [...catMap.entries()]
      .map(([category, rs]) => {
        const catScores = rs.map((r) => r.editor_score).filter((s): s is number => s != null);
        const catConfs  = rs.map((r) => r.ai_confidence).filter((c): c is number => c != null);
        const catAcc    = rs.filter((r) => r._match >= 0.9).length;
        return {
          category,
          cnt:             rs.length,
          avg_score:       round(avg(catScores), 2),
          avg_confidence:  round(avg(catConfs), 1),
          acceptance_rate: round(rs.length ? (catAcc / rs.length) * 100 : null, 1),
          avg_match:       round(avg(rs.map((r) => r._match)), 3),
        };
      })
      .sort((a, b) => (a.avg_score ?? 99) - (b.avg_score ?? 99));

    // ── Score distribution ─────────────────────────────────────────────────
    const score_dist = [1, 2, 3, 4, 5].map((s) => ({
      score: s,
      cnt: rows.filter((r) => r.editor_score === s).length,
    }));

    // ── By suggested_action ────────────────────────────────────────────────
    const actionMap = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.suggested_action ?? "ללא";
      if (!actionMap.has(k)) actionMap.set(k, []);
      actionMap.get(k)!.push(r);
    }
    const by_action = [...actionMap.entries()].map(([action, rs]) => ({
      action,
      cnt:       rs.length,
      avg_score: round(avg(rs.map((r) => r.editor_score).filter((s): s is number => s != null)), 2),
    }));

    // ── Trend by day ───────────────────────────────────────────────────────
    const dayMap = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.day ?? "ללא";
      if (!dayMap.has(k)) dayMap.set(k, []);
      dayMap.get(k)!.push(r);
    }
    const by_day = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, rs]) => ({
        day,
        cnt:       rs.length,
        avg_score: round(avg(rs.map((r) => r.editor_score).filter((s): s is number => s != null)), 2),
      }));

    // ── Confidence calibration ─────────────────────────────────────────────
    const confBuckets = [
      { label: "0–20",   min: 0,  max: 20  },
      { label: "21–40",  min: 21, max: 40  },
      { label: "41–60",  min: 41, max: 60  },
      { label: "61–80",  min: 61, max: 80  },
      { label: "81–100", min: 81, max: 100 },
    ];
    const conf_calib = confBuckets.map(({ label, min, max }) => {
      const rs = rows.filter((r) => r.ai_confidence != null && r.ai_confidence >= min && r.ai_confidence <= max);
      return {
        bucket:    label,
        cnt:       rs.length,
        avg_score: round(avg(rs.map((r) => r.editor_score).filter((s): s is number => s != null)), 2),
      };
    }).filter((b) => b.cnt > 0);

    // ── Needs attention ────────────────────────────────────────────────────
    const needs_attention = rows
      .filter((r) => (r.editor_corrected_reply?.trim() ?? "") !== "")
      .sort((a, b) => a._match - b._match)
      .slice(0, 10)
      .map((r) => ({
        id:                    r.id,
        customer_name:         r.customer_name,
        category:              r.category,
        proposed_reply:        r.proposed_reply,
        editor_corrected_reply: r.editor_corrected_reply,
        match_score:           round(r._match, 3),
      }));

    res.json({ kpi, by_category, score_dist, by_action, by_day, conf_calib, needs_attention });
  } catch (err) {
    logger.error({ err }, "whatsapp/analytics failed");
    res.status(500).json({ error: "שגיאה בטעינת אנליטיקה" });
  }
});

export default router;
