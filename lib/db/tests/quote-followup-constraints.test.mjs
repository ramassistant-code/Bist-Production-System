import assert from "node:assert/strict";
import { after, before, beforeEach, afterEach, describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, "../sql/quotes");

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://ubuntu@/bist_followup_test?host=/var/run/postgresql";

const QUOTE_STATUS_VALUES = [
  "טיוטה",
  "נשלחה ללקוח",
  "נחתמה",
  "נדחתה",
  "פג תוקף",
  "בוטלה",
];

const QUOTA_STATES = ["awaiting_delivered", "active", "paused"];
const RELEASED_STATES = ["stopped", "completed", "delivery_failed"];

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
/** @type {pg.PoolClient} */
let client;
let quoteCounter = 0;

async function expectSqlState(fn, code) {
  const sp = `sp_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  await client.query(`savepoint ${sp}`);
  try {
    await fn();
  } catch (err) {
    if (err.code === "ERR_ASSERTION") throw err;
    await client.query(`rollback to savepoint ${sp}`);
    assert.equal(err.code, code, err.message);
    return err;
  }
  assert.fail(`expected SQLSTATE ${code}, but the statement succeeded`);
}

async function insertQuoteAndVersion() {
  quoteCounter += 1;
  const quoteNumber = `Q-TEST-${String(quoteCounter).padStart(6, "0")}`;
  const quote = await client.query(
    `insert into quotes (quote_number) values ($1) returning id`,
    [quoteNumber],
  );
  const version = await client.query(
    `insert into quote_versions (quote_id, version_number) values ($1, 1) returning id`,
    [quote.rows[0].id],
  );
  return { quoteId: quote.rows[0].id, versionId: version.rows[0].id };
}

async function insertSequence({
  quoteId,
  versionId,
  phone = "+972501000001",
  chatId = null,
  state = "awaiting_delivered",
}) {
  const result = await client.query(
    `insert into quote_followup_sequences
       (quote_id, quote_version_id, phone_e164, provider_chat_id, state)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [quoteId, versionId, phone, chatId, state],
  );
  return result.rows[0].id;
}

describe("BIS-10 quote follow-up constraints", () => {
  before(async () => {
    const parentsSql = fs.readFileSync(path.join(sqlDir, "00_test_parents.sql"), "utf8");
    const migrationSql = fs.readFileSync(path.join(sqlDir, "01_quote_followup.sql"), "utf8");
    const setup = await pool.connect();
    try {
      await setup.query(parentsSql);
      await setup.query(migrationSql);
    } finally {
      setup.release();
    }
  });

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });

  afterEach(async () => {
    await client.query("rollback");
    client.release();
  });

  test("quote_status enum is unchanged (Hebrew values only)", async () => {
    const { rows } = await client.query(
      `select e.enumlabel
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'quote_status'
        order by e.enumsortorder`,
    );
    assert.deepEqual(
      rows.map((row) => row.enumlabel),
      QUOTE_STATUS_VALUES,
    );

    const migrationSql = fs.readFileSync(path.join(sqlDir, "01_quote_followup.sql"), "utf8");
    assert.equal(/alter\s+type\s+quote_status/i.test(migrationSql), false);
    assert.equal(/add\s+value/i.test(migrationSql), false);
  });

  test("quota indexes are partial unique indexes, not plain unique indexes", async () => {
    const { rows } = await client.query(
      `select indexname, indexdef
         from pg_indexes
        where indexname in (
          'quote_followup_sequences_phone_e164_quota_uidx',
          'quote_followup_sequences_provider_chat_id_quota_uidx'
        )
        order by indexname`,
    );
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.match(row.indexdef, /UNIQUE/i);
      assert.match(row.indexdef, /WHERE/i);
      assert.match(row.indexdef, /awaiting_delivered/);
      assert.match(row.indexdef, /active/);
      assert.match(row.indexdef, /paused/);
    }
    const chat = rows.find((row) => row.indexname.includes("provider_chat_id"));
    assert.match(chat.indexdef, /provider_chat_id IS NOT NULL/i);
  });

  test("second sequence for the same quote_version_id fails", async () => {
    const { quoteId, versionId } = await insertQuoteAndVersion();
    await insertSequence({ quoteId, versionId, phone: "+972501000001" });
    await expectSqlState(
      () => insertSequence({ quoteId, versionId, phone: "+972501000002" }),
      "23505",
    );
  });

  test("second quota-holding sequence for the same phone_e164 fails", async () => {
    for (const [i, state] of QUOTA_STATES.entries()) {
      const phone = `+9725010010${i}0`;
      const first = await insertQuoteAndVersion();
      const second = await insertQuoteAndVersion();
      await insertSequence({
        quoteId: first.quoteId,
        versionId: first.versionId,
        phone,
        state,
      });
      await expectSqlState(
        () =>
          insertSequence({
            quoteId: second.quoteId,
            versionId: second.versionId,
            phone,
            state: "active",
          }),
        "23505",
      );
    }
  });

  test("a second sequence for the same phone succeeds when the first is stopped, completed, or delivery_failed", async () => {
    for (const [i, released] of RELEASED_STATES.entries()) {
      const phone = `+9725010020${i}0`;
      const first = await insertQuoteAndVersion();
      const second = await insertQuoteAndVersion();
      await insertSequence({
        quoteId: first.quoteId,
        versionId: first.versionId,
        phone,
        state: released,
      });
      const id = await insertSequence({
        quoteId: second.quoteId,
        versionId: second.versionId,
        phone,
        state: "active",
      });
      assert.ok(id);
    }
  });

  test("phone_e164 must be E.164 with a leading plus, not a Whapi send field", async () => {
    const { quoteId, versionId } = await insertQuoteAndVersion();
    await expectSqlState(
      () =>
        insertSequence({
          quoteId,
          versionId,
          phone: "972501000099",
        }),
      "23514",
    );
  });

  test("second quota-holding sequence for the same provider_chat_id fails", async () => {
    for (const [i, state] of QUOTA_STATES.entries()) {
      const chatId = `chat-quota-${i}`;
      const first = await insertQuoteAndVersion();
      const second = await insertQuoteAndVersion();
      await insertSequence({
        quoteId: first.quoteId,
        versionId: first.versionId,
        phone: `+9725010030${i}0`,
        chatId,
        state,
      });
      await expectSqlState(
        () =>
          insertSequence({
            quoteId: second.quoteId,
            versionId: second.versionId,
            phone: `+9725010031${i}0`,
            chatId,
            state: "active",
          }),
        "23505",
      );
    }
  });

  test("a second sequence for the same provider_chat_id succeeds when the first is stopped, completed, or delivery_failed", async () => {
    for (const [i, released] of RELEASED_STATES.entries()) {
      const chatId = `chat-released-${i}`;
      const first = await insertQuoteAndVersion();
      const second = await insertQuoteAndVersion();
      await insertSequence({
        quoteId: first.quoteId,
        versionId: first.versionId,
        phone: `+9725010040${i}0`,
        chatId,
        state: released,
      });
      const id = await insertSequence({
        quoteId: second.quoteId,
        versionId: second.versionId,
        phone: `+9725010041${i}0`,
        chatId,
        state: "active",
      });
      assert.ok(id);
    }
  });

  test("null provider_chat_id does not collide across quota-holding sequences", async () => {
    const first = await insertQuoteAndVersion();
    const second = await insertQuoteAndVersion();
    await insertSequence({
      quoteId: first.quoteId,
      versionId: first.versionId,
      phone: "+972501000050",
      chatId: null,
      state: "active",
    });
    const id = await insertSequence({
      quoteId: second.quoteId,
      versionId: second.versionId,
      phone: "+972501000051",
      chatId: null,
      state: "paused",
    });
    assert.ok(id);
  });

  test("second step of the same kind on one sequence fails", async () => {
    const { quoteId, versionId } = await insertQuoteAndVersion();
    const sequenceId = await insertSequence({ quoteId, versionId, phone: "+972501000060" });
    await client.query(
      `insert into quote_followup_steps (sequence_id, step_kind) values ($1, 'opening')`,
      [sequenceId],
    );
    await expectSqlState(
      () =>
        client.query(
          `insert into quote_followup_steps (sequence_id, step_kind) values ($1, 'opening')`,
          [sequenceId],
        ),
      "23505",
    );
    await client.query(
      `insert into quote_followup_steps (sequence_id, step_kind) values ($1, 'followup_1')`,
      [sequenceId],
    );
  });

  test("duplicate inbound event (same message id + status) fails; a different status succeeds", async () => {
    await client.query(
      `insert into quote_followup_inbound_events (provider_message_id, status)
       values ('wamid.TEST-1', 'delivered')`,
    );
    await expectSqlState(
      () =>
        client.query(
          `insert into quote_followup_inbound_events (provider_message_id, status)
           values ('wamid.TEST-1', 'delivered')`,
        ),
      "23505",
    );
    const { rows } = await client.query(
      `insert into quote_followup_inbound_events (provider_message_id, status)
       values ('wamid.TEST-1', 'read')
       returning id`,
    );
    assert.ok(rows[0].id);
  });

  test("an inbound event can be inserted before any step has that message id", async () => {
    const { rows } = await client.query(
      `insert into quote_followup_inbound_events
         (provider_message_id, status, recipient_id, chat_id, from_id, text_body, quoted_id)
       values ('wamid.BEFORE-STEP', 'delivered', '972501000070', '972501000070@c.us', '+972501000070', 'hi', 'wamid.quoted')
       returning id, step_id, sequence_id`,
    );
    assert.ok(rows[0].id);
    assert.equal(rows[0].step_id, null);
    assert.equal(rows[0].sequence_id, null);

    const existing = await client.query(
      `select 1 from quote_followup_steps where provider_message_id = 'wamid.BEFORE-STEP'`,
    );
    assert.equal(existing.rowCount, 0);
  });

  test("settings cannot have a second row", async () => {
    const { rows } = await client.query(`select count(*)::int as n from quote_followup_settings`);
    assert.equal(rows[0].n, 1);
    await expectSqlState(
      () =>
        client.query(
          `insert into quote_followup_settings (id, template_opening, template_followup_1, template_followup_2, template_followup_3)
           values (1, 'a', 'b', 'c', 'd')`,
        ),
      "23505",
    );
    await expectSqlState(
      () =>
        client.query(
          `insert into quote_followup_settings (id, template_opening, template_followup_1, template_followup_2, template_followup_3)
           values (2, 'a', 'b', 'c', 'd')`,
        ),
      "23514",
    );
  });

  test("settings seed: disabled, 09:00–18:00, Sunday–Thursday, offsets 2/5/10, approved templates", async () => {
    const { rows } = await client.query(`select * from quote_followup_settings where id = 1`);
    const row = rows[0];
    assert.equal(row.enabled, false);
    assert.equal(String(row.window_start).startsWith("09:00"), true);
    assert.equal(String(row.window_end).startsWith("18:00"), true);
    assert.deepEqual(row.business_days, [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
    ]);
    assert.equal(row.followup_1_offset_days, 2);
    assert.equal(row.followup_2_offset_days, 5);
    assert.equal(row.followup_3_offset_days, 10);
    assert.equal(
      row.template_opening,
      "שלום {{customer_name}},\nמצורפת הצעת המחיר {{quote_number}}.\nלצפייה ולחתימה: {{sign_link}}\nההצעה בתוקף עד {{valid_until}}.\n{{salesperson_name}}",
    );
    assert.equal(
      row.template_followup_1,
      "שלום {{customer_name}},\nרציתי לוודא שהצעת המחיר {{quote_number}} הגיעה אליך.\nלצפייה ולחתימה: {{sign_link}}\nההצעה בתוקף עד {{valid_until}}.",
    );
    assert.equal(
      row.template_followup_2,
      "שלום {{customer_name}},\nהצעת המחיר {{quote_number}} עדיין ממתינה לאישורך.\nלצפייה ולחתימה: {{sign_link}}\nתוקף עד {{valid_until}}. אם צריך משהו נוסף, אפשר להשיב להודעה הזו.",
    );
    assert.equal(
      row.template_followup_3,
      "שלום {{customer_name}},\nזו תזכורת אחרונה לגבי הצעת המחיר {{quote_number}}.\nלצפייה ולחתימה: {{sign_link}}\nההצעה בתוקף עד {{valid_until}}. אחרי המועד הלינק לא יהיה פעיל.",
    );
  });

  test("cancel reasons seed and אחר requires_detail", async () => {
    const { rows } = await client.query(
      `select code, label, requires_detail from quote_cancel_reasons order by sort_order`,
    );
    assert.deepEqual(
      rows.map((row) => row.label),
      [
        "לא רלוונטי",
        "בחר בספק אחר",
        "אין תקציב",
        "התזמון אינו מתאים",
        "לא ניתן להשיג את הלקוח",
        "הצעה כפולה או שגויה",
        "אחר",
      ],
    );
    const needingDetail = rows.filter((row) => row.requires_detail);
    assert.equal(needingDetail.length, 1);
    assert.equal(needingDetail[0].code, "other");
    assert.equal(needingDetail[0].label, "אחר");
  });

  test("second active communication_blocks row for the same phone_e164 fails; after removed_at a new active row succeeds", async () => {
    const first = await client.query(
      `insert into communication_blocks (phone_e164) values ('+972501000080') returning id`,
    );
    await expectSqlState(
      () =>
        client.query(`insert into communication_blocks (phone_e164) values ('+972501000080')`),
      "23505",
    );
    await client.query(`update communication_blocks set removed_at = now() where id = $1`, [
      first.rows[0].id,
    ]);
    const second = await client.query(
      `insert into communication_blocks (phone_e164) values ('+972501000080') returning id`,
    );
    assert.ok(second.rows[0].id);
  });

  test("second active communication_blocks row for the same provider_chat_id fails; after removed_at a new active row succeeds", async () => {
    const first = await client.query(
      `insert into communication_blocks (phone_e164, provider_chat_id)
       values ('+972501000081', 'chat-abc') returning id`,
    );
    await expectSqlState(
      () =>
        client.query(
          `insert into communication_blocks (phone_e164, provider_chat_id)
           values ('+972501000082', 'chat-abc')`,
        ),
      "23505",
    );
    await client.query(`update communication_blocks set removed_at = now() where id = $1`, [
      first.rows[0].id,
    ]);
    const second = await client.query(
      `insert into communication_blocks (phone_e164, provider_chat_id)
       values ('+972501000082', 'chat-abc') returning id`,
    );
    assert.ok(second.rows[0].id);
  });

  test("second active communication_blocks row for the same lid fails; after removed_at a new active row succeeds", async () => {
    const first = await client.query(
      `insert into communication_blocks (phone_e164, lid)
       values ('+972501000083', '12345@lid') returning id`,
    );
    await expectSqlState(
      () =>
        client.query(
          `insert into communication_blocks (phone_e164, lid)
           values ('+972501000084', '12345@lid')`,
        ),
      "23505",
    );
    await client.query(`update communication_blocks set removed_at = now() where id = $1`, [
      first.rows[0].id,
    ]);
    const second = await client.query(
      `insert into communication_blocks (phone_e164, lid)
       values ('+972501000084', '12345@lid') returning id`,
    );
    assert.ok(second.rows[0].id);
  });

  test("communication_blocks can link to existing customers and leads", async () => {
    const customer = await client.query(
      `insert into customers (customer_number, name, phone)
       values ('C-TEST-1', 'לקוח בדיקה', '+972501000090') returning id`,
    );
    const lead = await client.query(
      `insert into leads (lead_number, name, phone)
       values ('L-TEST-1', 'ליד בדיקה', '+972501000091') returning id`,
    );
    const withCustomer = await client.query(
      `insert into communication_blocks (phone_e164, customer_id)
       values ('+972501000090', $1) returning customer_id, lead_id`,
      [customer.rows[0].id],
    );
    const withLead = await client.query(
      `insert into communication_blocks (phone_e164, lead_id)
       values ('+972501000091', $1) returning customer_id, lead_id`,
      [lead.rows[0].id],
    );
    assert.equal(withCustomer.rows[0].customer_id, customer.rows[0].id);
    assert.equal(withCustomer.rows[0].lead_id, null);
    assert.equal(withLead.rows[0].lead_id, lead.rows[0].id);
    assert.equal(withLead.rows[0].customer_id, null);
  });

  test("delete of quote_activity fails", async () => {
    const { quoteId } = await insertQuoteAndVersion();
    const inserted = await client.query(
      `insert into quote_activity (quote_id, event_kind, actor_type, payload)
       values ($1, 'message_sent', 'system', '{"text":"hello"}'::jsonb)
       returning id`,
      [quoteId],
    );
    const err = await expectSqlState(
      () => client.query(`delete from quote_activity where id = $1`, [inserted.rows[0].id]),
      "P0001",
    );
    assert.match(err.message, /append-only/);
    const leftover = await client.query(`select count(*)::int as n from quote_activity where id = $1`, [
      inserted.rows[0].id,
    ]);
    assert.equal(leftover.rows[0].n, 1);
  });
});
