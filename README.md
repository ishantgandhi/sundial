# Sundial

Sundial is a visual time machine for Postgres. It records every change to a table from the write-ahead log, then lets you drag a slider to see the table at any past moment, compare it with now, and restore damaged rows.

<!-- TODO: add GIF -->

[Watch the demo video on YouTube](https://youtu.be/5cPToYthrHU)

Built with TypeScript, Node, Express, React (Vite) and Postgres 16 in Docker.

## What you can do

- **Time travel.** Drag the slider to any committed transaction and see the table as it was right after it. The last stop, "Now", is the live table. The page also lists the row changes inside the selected transaction.
- **Diff.** The page compares the chosen moment with the live table. It marks added, removed and changed rows, and changed cells show `old → new`. The `diff` command compares any two moments.
- **Selective restore.** Tick the rows you want back. A dialog shows the plan first and changes nothing until you confirm.
  - Each live row is checked against what the plan expected. If a row changed since the plan was made, nothing is applied and you get a conflict.
  - All actions run in one transaction, so they all apply or none do.
  - A restore is a normal transaction, so capture records it like any other change. To undo it, move to the moment before it and restore again.

## How it works

1. A logical replication slot named `sundial_slot` uses the `test_decoding` plugin to stream committed changes. The `orders` table has `REPLICA IDENTITY FULL`, so updates and deletes carry the whole old row.
2. `capture` reads the slot without consuming it, groups the lines into transactions, and saves each transaction whole to a separate history database. The slot only watches the orders database, so saving history never creates new changes to capture. Only after saving does it advance the slot. If it crashes in between, the same transactions arrive again and are skipped, because each one is stored under its commit LSN.
3. To see the table at time T, Sundial takes the latest snapshot at or before T, then replays the saved changes after it, up to T. A snapshot is a full copy of the table's rows, stored as JSON at one log position.
4. Compaction saves a new snapshot about every 1000 changes, always between transactions. While `capture` runs it does this once a minute, starting one minute after startup.

The history database has two tables: `changes` (one row per row change) and `snapshots`.

## Performance

This is a synthetic benchmark, not real traffic. `bench:seed` invents 1,000,000 changes for a fake table called `bench_orders`. `bench:run` rebuilds the table at 1%, 10%, 50% and 100% of that history and reports the median of 3 runs. All numbers are from one laptop with Postgres in Docker.

Rebuilding the table near the end of history:

| Step | Time |
| --- | --- |
| One empty snapshot at the start | 8,860 ms |
| After compaction (a snapshot every 1000 changes) | 96 ms |
| After indexes on `changes(table_name, lsn, id)` and `snapshots(table_name, taken_at)` | about 8 ms |

Snapshots add about 1% to the size of the history database (about 9 MB on top of about 760 MB). Rebuilding the middle of history is slower. See Known limits.

## Run it locally

You need Docker and Node 20.12 or newer. There is no `.env.example` in the repo, so you create `.env` yourself.

1. Start Postgres. On the first start it creates the `orders` table from `db/init.sql`. Port 5432 must be free.

   ```bash
   docker compose up -d
   ```

2. Create the history database and its tables. Compose does not do this for you.

   ```bash
   docker compose exec -T db psql -U postgres -c "CREATE DATABASE sundial_history"
   docker compose exec -T db psql -U postgres -d sundial_history < db/history.sql
   ```

3. Create `.env` in the repo root. These values match `docker-compose.yml`.

   ```
   DATABASE_URL=postgres://postgres:sundial@localhost:5432/postgres
   HISTORY_DATABASE_URL=postgres://postgres:sundial@localhost:5432/sundial_history
   ```

4. Install. The web app has its own dependencies.

   ```bash
   npm install
   npm install --prefix web
   npm run dev
   ```

   `npm run dev` only checks the connection. It prints `connected, orders has 3 rows`.

5. Start capture and leave it running. It creates the slot on first run.

   ```bash
   npm run capture
   ```

6. In other terminals, take the first snapshot once, then start the API and the web app.

   ```bash
   npm run snapshot
   npm run server   # API on http://localhost:3001
   npm run web      # app on http://localhost:5173
   ```

Open http://localhost:5173. Change some rows in `orders`, then press Refresh on the page to load the new transactions. The live table on the side updates by itself every 3 seconds.

`db/init.sql` runs only on the first start of the Postgres volume. To run it again, use `docker compose down -v` first.

## Commands

Run these from the repo root. Times are Postgres timestamps, like `"2026-11-20 03:45:00+00"`.

| Command | What it does |
| --- | --- |
| `npm run rebuild -- "<time>"` | Prints the `orders` table at that time. |
| `npm run diff -- "<time A>" "<time B>"` | Lists rows added, removed and changed between two times. |
| `npm run restore -- "<time>"` | Prints the plan to bring the live table back to that time. Changes nothing. |
| `npm run restore -- "<time>" --ids=3,4` | Same, for only those row ids. |
| `npm run restore -- "<time>" --ids=3,4 --apply` | Runs the plan on the live table in one transaction. Refuses on a conflict. `--ids` is optional. |
| `npm run snapshot` | Saves a snapshot of the live `orders` table. It blocks writes to the table (reads still work) while it copies. |
| `npm run compact -- <table> [N]` | Saves a snapshot about every N changes (default 1000), starting from the latest one. |
| `npm run bench:seed -- [count]` | Makes a fake history for `bench_orders`, default 100000. Deletes older bench data first. |
| `npm run bench:run` | Times rebuilds at 1%, 10%, 50% and 100% of the bench history. Run `bench:seed` first. |

To reproduce the benchmark: `npm run bench:seed -- 1000000`, then `npm run bench:run`, then `npm run compact -- bench_orders 1000`, then `npm run bench:run` again.

## Known limits

- Schema changes are only partly handled. Old history has no value for a column added later. When restoring, columns that are missing from the live table are skipped, and new live columns are left alone.
- `TRUNCATE` is ignored. A rebuild after a truncate still shows the truncated rows.
- Row keys assume a column named `id`.
- Only the `orders` table is wired up. The server, the commands (except `compact`), snapshots, restore and automatic compaction all use `orders`.
- While `capture` is stopped, the slot keeps WAL on disk. If you stop using Sundial, drop the slot: `SELECT pg_drop_replication_slot('sundial_slot');`
- Rebuilding a moment in the middle of history is slower. In the benchmark it took about 70 to 80 ms at 50%, against about 8 ms near the end. The replay query filters on two things: changes after the snapshot, and changes up to the chosen time. An index can only narrow one of them, so Postgres reads rows it then throws away.
- Capture parses the text output of `test_decoding`, which is meant for debugging. Only text and number columns are converted. Other types, such as booleans and dates, stay as plain strings.
- Compaction runs inside the capture loop on the same connection. A long compaction pauses capture. Changes wait safely in the slot.
- The API has no login and listens on all network interfaces. Do not expose port 3001.
- There is no automated test suite.

## Future work

- Connect your own database table, with the table name and key column set in config instead of fixed in code.
- Handle dropped columns in restore, instead of skipping them.
