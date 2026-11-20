import pg from "pg";
import { rebuildAt } from "./rebuild.js";

process.loadEnvFile(".env");

const time = process.argv[2];
if (!time) {
  console.error('Usage: npm run rebuild -- "2026-11-20 03:45:00+00"');
  process.exit(1);
}

const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await history.connect();

try {
  // call rebuildAt for the "orders" table and print the result with console.table
  console.table(await rebuildAt(history, "orders", time));
} catch (err) {
  // print one clean line with the error's message (not the whole stack),
  //         and set process.exitCode = 1
  if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(String(err));
  }
  process.exit(1);
} finally {
  await history.end();
}