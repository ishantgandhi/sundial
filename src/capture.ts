import pg from "pg";
import { groupTransactions } from "./parse.js";
import { saveTransaction } from "./save.js";


// Load DATABASE_URL from the .env file.
process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
const historyDatabaseUrl = process.env.HISTORY_DATABASE_URL;
if (!databaseUrl || !historyDatabaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const SLOT_NAME = "sundial_slot";

// Connect to the orders database.
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

// Connect to the history database.
const historyClient = new pg.Client({ connectionString: historyDatabaseUrl });
await historyClient.connect();

// Look in pg_replication_slots to see if our slot already exists.
const existing = await client.query("SELECT 1 FROM pg_replication_slots WHERE slot_name = $1", [SLOT_NAME]);

// Create the slot (using the test_decoding plugin) only if it's missing.
if (existing.rowCount === 0) {
  await client.query("SELECT pg_create_logical_replication_slot($1, 'test_decoding')", [SLOT_NAME]);
  console.log(`created slot ${SLOT_NAME}`);
} else {
  console.log(`slot ${SLOT_NAME} already exists`);
}

// Flag that the loop below checks; Ctrl+C flips it to false.
let running = true;
process.on("SIGINT", () => {
  console.log("\nstopping...");
  running = false;
});

// Pause for the given number of milliseconds.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("capturing changes, press Ctrl+C to stop");

while (running) {
  // Ask Postgres for any new changes since the last poll (this also marks them as consumed).
  const result = await client.query<{ lsn: string; xid: string; data: string }>(
    "SELECT lsn, xid, data FROM pg_logical_slot_peek_changes($1, NULL, NULL, 'include-timestamp', '1')", [SLOT_NAME],
  );
  const txns = groupTransactions(result.rows); // group the transactions into envelopes

  // Print each change as "lsn | xid | data".
  for (const txn of txns) {
    console.log(`${txn.xid} | ${txn.commitLsn} | ${txn.committedAt}`);
    for (const change of txn.changes) {
      console.log(`${change.tableName} | ${change.action} | ${change.rowKey.id} | ${change.oldRow?.id} | ${change.newRow?.id}`);
    }
    const saved = await saveTransaction(historyClient, txn); // save the transaction to the history database
    if (saved) {
      console.log(`saved transaction ${txn.xid}`);
    } else {
      console.log(`transaction ${txn.xid} already saved`);
    }
  }
  const lastTxn = txns[txns.length - 1]; // last transaction is the one we need to advance the slot to
  if (txns.length > 0) {
    await client.query("SELECT pg_replication_slot_advance($1, $2)", [SLOT_NAME, lastTxn.commitLsn]); // advance the slot to the next transaction
  }

  // Wait 1 second before checking again.
  await sleep(1000);
}

// Close the database connection cleanly now that we've stopped.
await client.end();
