import pg from "pg";

type Row = Record<string, any>;

export async function rebuildAt(history: pg.Client, tableName: string, time: string): Promise<Row[]> {
  // find the latest snapshot for this table taken at or before `time`.
  //         If there isn't one, throw an Error saying there's no data before that time.
  const result = await history.query("SELECT * FROM snapshots WHERE table_name = $1 AND taken_at <= $2 ORDER BY taken_at DESC LIMIT 1", [tableName, time]);
  if (result.rows.length === 0) {
    throw new Error(`No snapshot found for table ${tableName} at or before ${time}`);
  }
  const snapshot = result.rows[0];
  // load the changes to apply. Two conditions, ordered by lsn then id.
  const changes = await history.query("SELECT * FROM changes WHERE table_name = $1 AND lsn > $2 AND committed_at <= $3 ORDER BY lsn, id", [tableName, snapshot.lsn, time]);

  // The map: key is the row's key as text, value is the row itself.
  const table = new Map<string, Row>();
  // fill the map from the snapshot's rows.
  for (const row of snapshot.rows) {
    table.set(JSON.stringify({ id: row.id }), row);
  }
  // go through the changes in order and apply each one to the map.
  for (const change of changes.rows) {
    const key = JSON.stringify(change.row_key);
    if (change.action === "delete") {
      // remove the key from the map
      table.delete(key);
    } else {
      // insert and update: put change.new_row in the map under that key
      table.set(key, change.new_row);
    }
  }
  
  // return the map's rows as an array, sorted by id.
  return Array.from(table.values()).sort((a, b) => a.id - b.id);
}