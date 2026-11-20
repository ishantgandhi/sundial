// A row is just column name -> value.
export type Row = Record<string, string | number | null>;

export type Change = {
  tableName: string;
  action: "insert" | "update" | "delete";
  rowKey: { id: Row[string] };
  oldRow: Row | null;
  newRow: Row | null;
};

// Matches either a section marker ("old-key:" / "new-tuple:") or one column like name[type]:value.
// The value is either a 'quoted string' (where '' means a literal quote) or a run of non-space characters.
// Because quoted strings are matched whole, a marker word inside a quoted value is never mistaken for a marker.
const TOKEN = /(old-key|new-tuple):|(\w+)\[([^\]]+)\]:('(?:[^']|'')*'|\S+)/g;

// Column types whose values we turn into real JS numbers.
const NUMERIC_TYPES = new Set(["smallint", "integer", "bigint", "numeric", "real", "double precision"]);

// Turn one raw value string (as test_decoding prints it) into a JS value.
function parseValue(type: string, raw: string): string | number | null {
  if (raw.startsWith("'")) return raw.slice(1, -1).replaceAll("''", "'"); // quoted text: strip quotes, unescape ''
  if (raw === "null") return null; // unquoted null means SQL NULL
  if (NUMERIC_TYPES.has(type)) return Number(raw); // numbers arrive as text, convert them
  return raw; // anything else (booleans, etc.) stays as the raw string
}

// Turn one line of test_decoding output into a change object, or null if it isn't a row change.
export function parseChangeLine(data: string): Change | null {
  // Match the start of a row-change line; BEGIN and COMMIT lines don't match and return null.
  const head = /^table (?:(\w+)\.)?(\w+): (\w+): (.*)$/s.exec(data);
  if (!head) return null;

  const [, , tableName, actionWord, body] = head;
  const action = actionWord.toLowerCase();
  if (action !== "insert" && action !== "update" && action !== "delete") return null; // e.g. TRUNCATE

  const oldRow: Row = {};
  const newRow: Row = {};

  // INSERT starts in the new row, DELETE and UPDATE start in the old row; markers switch sections.
  let current = action === "insert" ? newRow : oldRow;

  for (const m of body.matchAll(TOKEN)) {
    if (m[1]) {
      current = m[1] === "new-tuple" ? newRow : oldRow; // marker: switch which row we're filling
    } else {
      current[m[2]] = parseValue(m[3], m[4]); // column: store it under its name
    }
  }

  // Empty means that side wasn't present in the line (e.g. no old row on INSERT).
  const old = Object.keys(oldRow).length ? oldRow : null;
  const next = Object.keys(newRow).length ? newRow : null;

  // The key comes from the newest version of the row (the old one for DELETE). Assumes the column is "id".
  const source = next ?? old;
  return { tableName, action, rowKey: { id: source?.id ?? null }, oldRow: old, newRow: next };
}

export type Transaction = {
    xid: string;
    commitLsn: string;
    committedAt: string;
    changes: Change[];
  };
  
  type SlotRow = { lsn: string; xid: string; data: string };
  
  export function groupTransactions(rows: SlotRow[]): Transaction[] {
    const done: Transaction[] = [];
    let current: Transaction | null = null; // the envelope we're filling right now
  
    for (const row of rows) {
      // if the line starts with "BEGIN", open a new envelope
      //         (xid from the row, empty changes, commitLsn and committedAt blank for now)
      if (row.data.startsWith("BEGIN")) {
        current = {
          xid: row.xid,
          commitLsn: "",
          committedAt: "",
          changes: [],
        };
      }
      //  if the line starts with "COMMIT", fill in commitLsn and committedAt,
      //         add the envelope to `done`, and set `current` back to null
      if (row.data.startsWith("COMMIT")) {
        current!.commitLsn = row.lsn;
        current!.committedAt = /\(at (.*)\)/.exec(row.data)?.[1] ?? "";
        done.push(current!);
        current = null;
      }
      // otherwise it's a change line. Run parseChangeLine on it,
      //         and if you get a result, add it to current.changes
      const change = parseChangeLine(row.data);
      if (change) {
        current!.changes.push(change);
      }
    }
  
    return done;
  }