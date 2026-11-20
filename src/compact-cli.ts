import pg from "pg";
import { compactHistory } from "./compact.js";

process.loadEnvFile(".env");

const tableName = process.argv[2];
const n = process.argv[3] ? Number(process.argv[3]) : 1000;
if (!tableName) {
  console.error("Usage: npm run compact -- <table> [every N changes]");
  process.exit(1);
}

const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await history.connect();

try {
  const start = Date.now();
  const created = await compactHistory(history, tableName, n);
  console.log(`created ${created} snapshots for ${tableName} in ${Date.now() - start} ms`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await history.end();
}