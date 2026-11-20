import pg from "pg";

type Row = Record<string, any>;

const PAGE_SIZE = 10000;

// Walks the saved history for one table and saves a snapshot roughly every `n` changes.
// Starts from the latest existing snapshot, so running it again only does the new work.
export async function compactHistory(history: pg.Client, tableName: string, n = 1000): Promise<number> {
  // Load the latest snapshot and start the map from its rows.
  const snap = await history.query(
    "SELECT lsn, rows FROM snapshots WHERE table_name = $1 ORDER BY taken_at DESC LIMIT 1",
    [tableName]
  );
  if (snap.rows.length === 0) {
    throw new Error(`No snapshot found for table ${tableName}`);
  }

  // The map: row key as text -> the row. Keys match the ones rebuildAt uses.
  const table = new Map<string, Row>();
  for (const row of snap.rows[0].rows) {
    table.set(JSON.stringify({ id: row.id }), row);
  }

  // The cursor says where the next page starts. We begin right after the snapshot's own
  // transaction, so the id starts at the biggest possible value.
  let cursorLsn: string = snap.rows[0].lsn;
  let cursorId: string = "9223372036854775807";

  let sinceSnapshot = 0; // changes applied since the last snapshot
  let created = 0; // snapshots saved this run
  let prevLsn: string | null = null; // the transaction we just finished applying
  let prevTime: string | null = null;

  while (true) {
    // Read the next page of changes, in replay order. Time comes back as exact text.
    const page = await history.query(
      `SELECT id, lsn, committed_at::text AS committed_at, action, row_key, new_row
       FROM changes
       WHERE table_name = $1 AND (lsn, id) > ($2::pg_lsn, $3::bigint)
       ORDER BY lsn, id
       LIMIT $4`,
      [tableName, cursorLsn, cursorId, PAGE_SIZE]
    );
    if (page.rows.length === 0) break;

    for (const change of page.rows) {
      // A new transaction is starting. If we have applied enough changes, snapshot NOW,
      // before applying this change. The map is exactly the table as of the previous
      // transaction, so a transaction is never split in half.
      if (prevLsn !== null && change.lsn !== prevLsn && sinceSnapshot >= n) {
        await history.query(
          "INSERT INTO snapshots (table_name, taken_at, lsn, rows) VALUES ($1, $2, $3, $4)",
          [tableName, prevTime, prevLsn, JSON.stringify([...table.values()])]
        );
        created++;
        sinceSnapshot = 0;
      }

      // Apply the change to the map: delete removes the row, insert and update set it.
      const key = JSON.stringify(change.row_key);
      if (change.action === "delete") {
        table.delete(key);
      } else {
        table.set(key, change.new_row);
      }

      sinceSnapshot++;
      prevLsn = change.lsn;
      prevTime = change.committed_at;
    }

    // Next page starts after the last change we saw.
    const last = page.rows[page.rows.length - 1];
    cursorLsn = last.lsn;
    cursorId = last.id;
  }

  return created;
}