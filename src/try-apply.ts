import pg from "pg";
import { applyRestore } from "./restore-apply.js";

process.loadEnvFile(".env");
const live = new pg.Client({ connectionString: process.env.DATABASE_URL });
await live.connect();
try {
  await applyRestore(live, [
    { type: "insert", id: 3, row: { id: 3, customer: "Sana", status: "shipped", total: 90 } },
    { type: "update", id: 1,
      row: { id: 1, customer: "Maya", status: "pending", total: 50 },
      expected: { id: 1, customer: "Maya", status: "pending", total: 999 } },
  ]);
  console.log("applied (this should NOT happen)");
} catch (err) {
  console.log("refused:", err instanceof Error ? err.message : err);
} finally {
  await live.end();
}