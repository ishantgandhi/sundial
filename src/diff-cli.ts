import pg from "pg";
import { rebuildAt } from "./rebuild.js";
import { diffTables } from "./diff.js";

process.loadEnvFile(".env");

const [timeA, timeB] = process.argv.slice(2);
if (!timeA || !timeB) {
  console.error('Usage: npm run diff -- "<time A>" "<time B>"');
  process.exit(1);
}

const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await history.connect();

try {
  // TODO 1: rebuild the "orders" table at timeA and at timeB
  await rebuildAt(history, "orders", timeA);
  await rebuildAt(history, "orders", timeB);
  // TODO 2: diff them with diffTables
  const diff = diffTables(await rebuildAt(history, "orders", timeA), await rebuildAt(history, "orders", timeB));
  // TODO 3: print a readable summary (format below)
  console.log(`${diff.added.length} rows added`);
  console.log(`${diff.removed.length} rows removed`);
  console.log(`${diff.changed.length} rows changed`);
  for (const row of diff.added) {
    console.log(`+ ${JSON.stringify(row)}`);
  }
  for (const row of diff.removed) {
    console.log(`- ${JSON.stringify(row)}`);
  }
  for (const change of diff.changed) {
    console.log(`${change.id} changed: ${change.fields.join(", ")}`);
    console.log(`  before: ${JSON.stringify(change.before)}`);
    console.log(`  after: ${JSON.stringify(change.after)}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await history.end();
}