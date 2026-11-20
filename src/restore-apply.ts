import pg from "pg";
import type { Row } from "./diff.js";
import type { RestoreAction } from "./restore-plan.js";
import "./pg-setup.js"; // sameRow needs numeric columns as JS numbers, so every caller gets that automatically

// True if two rows have the same value in every column, checking the union of both rows' keys.
function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

export async function applyRestore(live: pg.Client, actions: RestoreAction[]): Promise<void> {
  // The columns that exist in the live table right now. We only ever write these.
  const colsResult = await live.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'"
  );
  const cols: string[] = colsResult.rows.map((r) => r.column_name);

  await live.query("BEGIN");
  try {
    for (const action of actions) {
      // Lock and read the current live row for action.id (undefined if there isn't one).
      const result = await live.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [action.id]);
      const liveRow: Row | undefined = result.rows[0];

      // Check the live row still matches what the plan expected; any mismatch is a conflict.
      if (action.type === "insert") {
        if (liveRow) {
          throw new Error(`row ${action.id} already exists`);
        }
      } else {
        if (!liveRow) {
          throw new Error(`row ${action.id} not found`);
        }
        if (!sameRow(liveRow, action.expected)) {
          throw new Error(`row ${action.id} changed`);
        }
      }

      // Run the change, passing every value as a parameter and only using column names found in `cols`.
      if (action.type === "insert") {
        const keys = Object.keys(action.row).filter((k) => cols.includes(k));
        const values = keys.map((k) => action.row[k]);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        await live.query(`INSERT INTO orders (${keys.join(", ")}) VALUES (${placeholders})`, values);
      } else if (action.type === "update") {
        // Only set columns that differ between the target row and the expected live row (never id).
        const keys = Object.keys(action.row).filter(
          (k) => k !== "id" && cols.includes(k) && action.row[k] !== action.expected[k]
        );
        if (keys.length > 0) {
          const values = keys.map((k) => action.row[k]);
          const assignments = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
          await live.query(`UPDATE orders SET ${assignments} WHERE id = $${keys.length + 1}`, [...values, action.id]);
        }
      } else if (action.type === "delete") {
        await live.query(`DELETE FROM orders WHERE id = $1`, [action.id]);
      }
    }
    await live.query("COMMIT");
  } catch (err) {
    await live.query("ROLLBACK");
    throw err;
  }
}
