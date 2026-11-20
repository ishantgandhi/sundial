import pg from "pg";
import type { Change, Transaction } from "./parse.ts";

// Saves one transaction into the changes table. Returns true if saved, false if it was already there.
export async function saveTransaction(history: pg.Client, txn: Transaction): Promise<boolean> {
  // check if this commitLsn is already in the changes table.
  // if it is, return false.
  const result = await history.query("SELECT 1 FROM changes WHERE lsn = $1", [txn.commitLsn]);
  if (result.rows.length > 0) {
    return false;
  }

  await history.query("BEGIN");
  try {
    for (const change of txn.changes) {
      //     insert one row into changes for this change.
      //       columns: lsn, xid, committed_at, table_name, action, row_key, old_row, new_row
      //       values: txn.commitLsn, txn.xid, txn.committedAt, change.tableName, change.action, change.rowKey, change.oldRow, change.newRow
      await history.query("INSERT INTO changes (lsn, xid, committed_at, table_name, action, row_key, old_row, new_row) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [txn.commitLsn, txn.xid, txn.committedAt, change.tableName, change.action, change.rowKey, change.oldRow, change.newRow]);
    }
    await history.query("COMMIT");
    return true;
  } catch (err) {
    await history.query("ROLLBACK");
    throw err;
  }
}