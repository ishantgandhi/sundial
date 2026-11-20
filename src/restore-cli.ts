import pg from "pg";
import { rebuildAt } from "./rebuild.js";
import { planRestore } from "./restore-plan.js";
import { applyRestore } from "./restore-apply.js";
import "./pg-setup.js"; // numeric columns as JS numbers, so live rows match the rebuilt rows

process.loadEnvFile(".env");

// Usage: npm run restore -- "<good time>" [--ids=3,4] [--apply]   (without --apply it only prints the plan)
const args = process.argv.slice(2);
const goodTime = args.find((a) => !a.startsWith("--"));
const idsArg = args.find((a) => a.startsWith("--ids="));
if (!goodTime) {
  console.error('Usage: npm run restore -- "<good time>" [--ids=3,4] [--apply]');
  process.exit(1);
}
// TODO 1: turn idsArg into an array of numbers, or undefined if it wasn't given
const ids = idsArg ? idsArg.slice(6).split(",").map(Number) : undefined;

const live = new pg.Client({ connectionString: process.env.DATABASE_URL });
const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await live.connect();
await history.connect();

try {
  // read the live orders table, ordered by id
  const liveRows = await live.query(`SELECT * FROM orders ORDER BY id`);
  // rebuild the table at goodTime, then call planRestore(liveRows, target, ids)
  const targetRows = await rebuildAt(history, "orders", goodTime);
  const plan = planRestore(liveRows.rows, targetRows, ids);
  // print the plan, one line per action (format below), or "nothing to restore"
  if (plan.length > 0) {
    for (const action of plan) {
    if (action.type === "insert") {
      console.log(`insert ${action.id} ${JSON.stringify(action.row)}`);
    } else if (action.type === "update") {
      console.log(`update ${action.id} ${JSON.stringify(action.row)} ${JSON.stringify(action.expected)}`);
    } else if (action.type === "delete") {
      console.log(`delete ${action.id} ${JSON.stringify(action.expected)}`);
    }
  } 
    // only when --apply was given: run the plan on the live table (all-or-nothing, refuses on any conflict)
    if (args.includes("--apply")) {
      await applyRestore(live, plan);
      console.log(`applied ${plan.length} action(s)`);
    }
  } else {
    console.log("nothing to restore");
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await live.end();
  await history.end();
}