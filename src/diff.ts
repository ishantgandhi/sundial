export type Row = Record<string, any>;

export type Diff = {
  added: Row[];
  removed: Row[];
  changed: { id: number; before: Row; after: Row; fields: string[] }[];
};

export function diffTables(a: Row[], b: Row[]): Diff {
  const diff: Diff = { added: [], removed: [], changed: [] };

  // Look rows up by id so matching is quick.
  const aById = new Map(a.map((row) => [row.id, row]));
  const bById = new Map(b.map((row) => [row.id, row]));

  // go through b. If the id isn't in a, the row was added.
  for (const row of b) {
    if (!aById.has(row.id)) {
      diff.added.push(row);
    }
  }
  // for rows in both, find which fields differ; rows with no differing fields are unchanged and skipped.
  for (const row of b) {
    if (aById.has(row.id)) {
      const aRow = aById.get(row.id)!;
      const keys = new Set([...Object.keys(aRow), ...Object.keys(row)]); 
      const changedFields = [...keys].filter(key => row[key] !== aRow[key]);
      if (changedFields.length > 0) {
        diff.changed.push({ id: row.id, before: aRow, after: row, fields: changedFields });
      }
    }
  }
  // go through a. If the id isn't in b, the row was removed.
  for (const row of a) {
    if (!bById.has(row.id)) {
      diff.removed.push(row);
    }
  }
  return diff;
}