import { diffTables, type Row } from "./diff.js";

export type RestoreAction =
  | { type: "insert"; id: number; row: Row }
  | { type: "update"; id: number; row: Row; expected: Row }
  | { type: "delete"; id: number; expected: Row };

// live = the table right now, target = the table at the good moment.
export function planRestore(live: Row[], target: Row[], ids?: number[]): RestoreAction[] {
  const diff = diffTables(live, target);
  let actions: RestoreAction[] = [];

  // diff.added = in target but not in live -> insert actions
  for (const row of diff.added) {
    actions.push({ type: "insert", id: row.id, row: row });
  }
  // diff.removed = in live but not in target -> delete actions (expected = the live row)
  for (const row of diff.removed) {
    actions.push({ type: "delete", id: row.id, expected: row });
  }
  // diff.changed -> update actions (row = the target version, expected = the live version)
  for (const change of diff.changed) {
    actions.push({ type: "update", id: change.id, row: change.after, expected: change.before });
  }
  // if ids was given, keep only the actions whose id is in it
  if (ids) {
    actions = actions.filter(action => ids.includes(action.id));
  }

  return actions;
}