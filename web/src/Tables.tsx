import { columns, fmt, type Diff, type Row } from "./api";

// One line in a table: a marker, an optional checkbox, and the cells.
// `after` + `fields` make those cells show "old → new" on a yellow background (a changed row).
type Line = { id: number; mark: "" | "+" | "−" | "~"; row: Row; after?: Row; fields?: string[] };

const KIND = { "": "", "+": "add", "−": "rem", "~": "chg" } as const;

function Lines({ lines, checked, onToggle }: { lines: Line[]; checked?: Set<number>; onToggle?: (id: number) => void }) {
  const cols = columns(lines.flatMap((l) => (l.after ? [l.row, l.after] : [l.row])));
  return (
    <table className="data mono">
      <thead>
        <tr>
          <th className="gutter" />
          {onToggle && <th className="check" />}
          {cols.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className={KIND[l.mark]}>
            <td className="gutter">{l.mark}</td>
            {onToggle && (
              <td className="check">
                <input type="checkbox" checked={checked?.has(l.id) ?? false} onChange={() => onToggle(l.id)} aria-label={`Restore row ${l.id}`} />
              </td>
            )}
            {cols.map((c) => {
              const changed = l.fields?.includes(c);
              return (
                <td key={c} className={changed ? "cell-chg" : ""}>
                  {changed && l.after ? `${fmt(l.row[c])} → ${fmt(l.after[c])}` : fmt(l.row[c])}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Left: the table at the chosen time. Rows that differ from live get the diff highlight too.
export function TableAt({ rows, diff }: { rows: Row[]; diff?: Diff }) {
  if (rows.length === 0) return <p className="dim">No rows</p>;
  const removed = new Set(diff?.removed.map((r) => r.id));
  const changed = new Map(diff?.changed.map((c) => [c.id, c]));
  const lines: Line[] = rows.map((row) => {
    const c = changed.get(row.id);
    if (c) return { id: row.id, mark: "~", row, after: c.after, fields: c.fields };
    return { id: row.id, mark: removed.has(row.id) ? "−" : "", row };
  });
  return <Lines lines={lines} />;
}

// Right: every difference between then and now, each with a checkbox for the restore.
export function DiffList({ diff, checked, onToggle }: { diff: Diff; checked: Set<number>; onToggle: (id: number) => void }) {
  const lines: Line[] = [
    ...diff.added.map((row): Line => ({ id: row.id, mark: "+", row })),
    ...diff.removed.map((row): Line => ({ id: row.id, mark: "−", row })),
    ...diff.changed.map((c): Line => ({ id: c.id, mark: "~", row: c.before, after: c.after, fields: c.fields })),
  ].sort((a, b) => a.id - b.id);
  if (lines.length === 0) return <p className="dim">No differences</p>;
  return <Lines lines={lines} checked={checked} onToggle={onToggle} />;
}

// The ids of every row in a diff.
export const diffIds = (d: Diff) => [...d.added, ...d.removed].map((r) => r.id).concat(d.changed.map((c) => c.id));
