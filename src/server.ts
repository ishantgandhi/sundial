import express, { type Request, type Response } from "express";
import cors from "cors";
import pg from "pg";
import { rebuildAt } from "./rebuild.js";
import { diffTables } from "./diff.js";
import { planRestore } from "./restore-plan.js";
import { applyRestore } from "./restore-apply.js";
import "./pg-setup.js"; // reads numeric columns as JS numbers (pg.types.setTypeParser(1700, Number)), once, at startup

process.loadEnvFile(".env");

const PORT = 3001;
const TABLE = "orders"; // the one table this server works on

// One connection to the live database, one to the history database.
const live = new pg.Client({ connectionString: process.env.DATABASE_URL });
const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await live.connect();
await history.connect();

// Read the live table, ordered by id. The table name is our constant, never a request value.
const liveRows = async () => (await live.query(`SELECT * FROM ${pg.escapeIdentifier(TABLE)} ORDER BY id`)).rows;

// Get a required text value from the query string, or throw (which becomes a 400).
function need(req: Request, name: string): string {
  const value = req.query[name];
  if (typeof value !== "string" || value === "") throw new Error(`missing query parameter: ${name}`);
  return value;
}

// Each connection can only do one thing at a time (and a restore uses a transaction),
// so requests wait in line and run one by one.
let queue: Promise<unknown> = Promise.resolve();

// Wraps a handler: runs it in line, sends its result as JSON, and turns any error into { error: message }.
// An error from applyRestore that is not a database error is a conflict (the live row changed), so it is a 409.
function route(handler: (req: Request) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    queue = queue.then(async () => {
      try {
        res.json(await handler(req));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const conflict = err instanceof ConflictError;
        res.status(conflict ? 409 : 400).json({ error: message });
      }
    });
  };
}

// Marks an error as a restore conflict.
class ConflictError extends Error {}

const app = express();
app.use(cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ })); // browsers on localhost only
app.use(express.json());

// Every commit after the first snapshot: its position, its time, and how many row changes it had.
// The time is sent as Postgres's own text (::text), not a JS Date, because a Date drops the microseconds
// and rebuilding at a cut-short time would miss that commit's own change.
app.get("/api/ticks", route(async () => {
  const result = await history.query(
    `SELECT lsn, min(committed_at)::text AS "committedAt", count(*)::int AS "changeCount"
     FROM changes
     WHERE table_name = $1
       AND lsn > (SELECT lsn FROM snapshots WHERE table_name = $1 ORDER BY taken_at, id LIMIT 1)
     GROUP BY lsn
     ORDER BY lsn`,
    [TABLE],
  );
  return result.rows;
}));

// The live table, right now.
app.get("/api/live", route(async () => liveRows()));

// The table as it was at the given time.
app.get("/api/table", route(async (req) => rebuildAt(history, TABLE, need(req, "at"))));

// What differs between the table at the given time and the live table now.
app.get("/api/compare", route(async (req) => diffTables(await rebuildAt(history, TABLE, need(req, "at")), await liveRows())));

// The raw captured changes of one commit.
app.get("/api/changes", route(async (req) => {
  const result = await history.query("SELECT * FROM changes WHERE lsn = $1 ORDER BY id", [need(req, "lsn")]);
  return result.rows;
}));

// Plan a restore to the given time. Only writes to the live table when apply is exactly true.
app.post("/api/restore", route(async (req) => {
  const { at, ids, apply } = req.body ?? {};
  if (typeof at !== "string" || at === "") throw new Error("body.at is required");
  if (ids !== undefined && !(Array.isArray(ids) && ids.every(Number.isInteger))) throw new Error("body.ids must be a list of whole numbers");

  const plan = planRestore(await liveRows(), await rebuildAt(history, TABLE, at), ids);
  if (apply !== true) return { plan };

  try {
    await applyRestore(live, plan);
  } catch (err) {
    // Database errors are bad requests; anything else from applyRestore means the live data no longer matches the plan.
    throw err instanceof pg.DatabaseError ? err : new ConflictError(err instanceof Error ? err.message : String(err));
  }
  return { applied: plan };
}));

// Bad JSON in a request body ends up here.
app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => console.log(`sundial server on http://localhost:${PORT}`));
