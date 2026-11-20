import pg from "pg";

// Load the database URLs from the .env file.
process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
const historyDatabaseUrl = process.env.HISTORY_DATABASE_URL;
if (!databaseUrl || !historyDatabaseUrl) {
  throw new Error("DATABASE_URL or HISTORY_DATABASE_URL is not set. Copy .env.example to .env.");
}

// Takes a snapshot of one table: freezes it, notes the log position, copies the rows, then saves them to history.
export async function takeSnapshot(source: pg.Client, history: pg.Client, tableName: string): Promise<string> {
  let lsn: string;
  let rows: unknown[];

  await source.query("BEGIN");
  try {
    // Block writes to the table (reads still work) so nothing changes between the next two steps.
    await source.query(`LOCK TABLE ${pg.escapeIdentifier(tableName)} IN SHARE MODE`);

    // Read the current log position: every change after this one will have a higher lsn.
    lsn = (await source.query("SELECT pg_current_wal_lsn() AS lsn")).rows[0].lsn;

    // Read all rows as JSON, in SQL, so numbers stay real numbers (same as the changes table).
    rows = (await source.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) AS rows FROM ${pg.escapeIdentifier(tableName)} t`,
    )).rows[0].rows;

    // Commit to release the lock; from here on writes can continue.
    await source.query("COMMIT");
  } catch (err) {
    await source.query("ROLLBACK");
    throw err;
  }

  // Save the copy to the history database (JSON.stringify because pg would turn a plain array into a Postgres array).
  await history.query("INSERT INTO snapshots (lsn, table_name, rows) VALUES ($1, $2, $3)", [lsn, tableName, JSON.stringify(rows)]);

  return lsn;
}

// Connect to the orders database and the history database.
const client = new pg.Client({ connectionString: databaseUrl });
const historyClient = new pg.Client({ connectionString: historyDatabaseUrl });
await client.connect();
await historyClient.connect();

try {
  const lsn = await takeSnapshot(client, historyClient, "orders");
  console.log(`snapshot of orders taken at ${lsn}`);
} finally {
  // Close both connections cleanly, even if the snapshot failed.
  await client.end();
  await historyClient.end();
}
