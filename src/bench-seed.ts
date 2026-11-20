import pg from "pg";

process.loadEnvFile(".env");

// Makes a big fake history for a table called "bench_orders" (the real "orders" history is never touched).
const TABLE = "bench_orders";
// How many transactions (one change each): the first command-line argument, default 100000.
// Example: npm run bench:seed -- 1000000
const TOTAL = Number(process.argv[2] ?? 100_000);
// The lsn is "1/" plus 8 hex digits, so it can count up to 4294967295.
if (!Number.isInteger(TOTAL) || TOTAL < 1 || TOTAL > 0xffffffff) {
  console.error("Usage: npm run bench:seed -- [number of changes, a whole number from 1 to 4294967295]");
  process.exit(1);
}
const FIRST_INSERTS = Math.min(1_000, TOTAL); // the first changes just insert rows 1..1000 (fewer if TOTAL is small)
const BATCH = 3_000; // rows per INSERT query (8 columns x 3000 stays under Postgres's 65535 parameter limit)
const START = Date.parse("2026-01-01T00:00:00Z"); // time of the first change; each next one is 1 second later

const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await history.connect();

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"];
const randomTotal = () => Math.round(Math.random() * 50_000) / 100;

// The table as it would be right now, so every change we invent is valid when replayed.
const rows = new Map<number, Record<string, unknown>>();
const ids: number[] = []; // the ids in `rows`, so we can pick a random one quickly
let nextId = 1;

function newRow() {
  const id = nextId++;
  const row = { id, customer: `customer-${id}`, status: pick(STATUSES), total: randomTotal() };
  rows.set(id, row);
  ids.push(id);
  return row;
}

// Invent one change and update our copy of the table to match.
function makeChange(i: number) {
  const roll = Math.random();
  // after the first inserts: ~80% update, ~10% delete, ~10% insert (an empty table can only insert)
  if (i < FIRST_INSERTS || ids.length === 0 || roll >= 0.9) {
    const row = newRow();
    return { action: "insert", id: row.id, oldRow: null, newRow: row };
  }
  const at = Math.floor(Math.random() * ids.length);
  const id = ids[at];
  const oldRow = rows.get(id)!;
  if (roll >= 0.8) {
    ids[at] = ids[ids.length - 1]; // remove the id from the list (swap with the last one)
    ids.pop();
    rows.delete(id);
    return { action: "delete", id, oldRow, newRow: null };
  }
  const row = { ...oldRow, status: pick(STATUSES), total: randomTotal() };
  rows.set(id, row);
  return { action: "update", id, oldRow, newRow: row };
}

const started = performance.now();

await history.query("BEGIN");
try {
  // start clean: remove any earlier bench data
  await history.query("DELETE FROM changes WHERE table_name = $1", [TABLE]);
  await history.query("DELETE FROM snapshots WHERE table_name = $1", [TABLE]);

  // one empty snapshot at log position 0/0, taken an hour before the first change
  await history.query("INSERT INTO snapshots (lsn, taken_at, table_name, rows) VALUES ('0/0', $1, $2, '[]')", [
    new Date(START - 3_600_000).toISOString(),
    TABLE,
  ]);

  for (let from = 0; from < TOTAL; from += BATCH) {
    const to = Math.min(from + BATCH, TOTAL);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (let i = from; i < to; i++) {
      const c = makeChange(i);
      const n = i + 1; // 1, 2, 3, ... (also used as the transaction id)
      const p = values.length;
      tuples.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8})`);
      values.push(
        `1/${n.toString(16).padStart(8, "0")}`, // lsn, counting up
        n, // xid
        new Date(START + i * 1000).toISOString(), // committed_at, one second apart
        TABLE,
        c.action,
        JSON.stringify({ id: c.id }),
        c.oldRow && JSON.stringify(c.oldRow), // null stays a real SQL NULL
        c.newRow && JSON.stringify(c.newRow),
      );
    }
    await history.query(
      `INSERT INTO changes (lsn, xid, committed_at, table_name, action, row_key, old_row, new_row) VALUES ${tuples.join(", ")}`,
      values,
    );
    // only one batch of rows is ever held in memory (plus our small copy of the live table), however big TOTAL is
    if (to % 100_000 < BATCH || to === TOTAL) console.log(`  ${to} / ${TOTAL}`);
  }
  await history.query("COMMIT");
} catch (err) {
  await history.query("ROLLBACK");
  throw err;
} finally {
  await history.end();
}

console.log(`seeded ${TOTAL} changes for ${TABLE} (${rows.size} rows at the end) in ${((performance.now() - started) / 1000).toFixed(1)}s`);
