import pg from "pg";
import { rebuildAt } from "./rebuild.js";

process.loadEnvFile(".env");

// Times rebuildAt on the fake history made by bench-seed.ts.
const TABLE = "bench_orders";
const PERCENTS = [1, 10, 50, 100];
const RUNS = 3; // each point is run this many times; we report the middle (median) time

const history = new pg.Client({ connectionString: process.env.HISTORY_DATABASE_URL });
await history.connect();

try {
  const total = Number((await history.query("SELECT count(*) AS n FROM changes WHERE table_name = $1", [TABLE])).rows[0].n);
  if (total === 0) throw new Error("No bench data. Run: npm run bench:seed");

  const results = [];
  for (const percent of PERCENTS) {
    // the time of the change that sits at this percent of the history (as exact Postgres text)
    const offset = Math.ceil((total * percent) / 100) - 1;
    const time: string = (
      await history.query("SELECT committed_at::text AS t FROM changes WHERE table_name = $1 ORDER BY lsn OFFSET $2 LIMIT 1", [TABLE, offset])
    ).rows[0].t;
    // how many changes a rebuild at that time has to replay (counted outside the timing)
    const replayed = Number(
      (await history.query("SELECT count(*) AS n FROM changes WHERE table_name = $1 AND committed_at <= $2", [TABLE, time])).rows[0].n,
    );

    const times: number[] = [];
    let rowCount = 0;
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      const rebuilt = await rebuildAt(history, TABLE, time);
      times.push(performance.now() - start);
      rowCount = rebuilt.length;
    }
    times.sort((a, b) => a - b);
    results.push({ percent: `${percent}%`, changes: replayed, ms: Math.round(times[Math.floor(RUNS / 2)]), rows: rowCount });
  }

  console.table(results);
} finally {
  await history.end();
}
