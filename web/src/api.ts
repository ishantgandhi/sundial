import { useEffect, useState } from "react";

// The shapes the server sends back.
export type Row = Record<string, any>;
export type Tick = { lsn: string; committedAt: string; changeCount: number };
export type Diff = {
  added: Row[];
  removed: Row[];
  changed: { id: number; before: Row; after: Row; fields: string[] }[];
};
export type Change = { id: number; action: "insert" | "update" | "delete"; row_key: Row; old_row: Row | null; new_row: Row | null };
export type PlanAction =
  | { type: "insert"; id: number; row: Row }
  | { type: "update"; id: number; row: Row; expected: Row }
  | { type: "delete"; id: number; expected: Row };

// "Now" is shown by asking for the table at a time far in the future.
export const FAR_FUTURE = "9999-12-31";

// An error from the server, keeping the HTTP status (409 means a conflict).
export class ApiError extends Error {
  status = 0;
}

// GET a path, or POST a JSON body when one is given. Throws ApiError with the server's message.
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(data.error ?? res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Loads a path whenever it (or `reload`) changes. Pass null to load nothing.
// While a new request runs, the previous data stays (loading is true), so the screen never goes blank.
export function useApi<T>(path: string | null, reload = 0) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: path !== null });
  useEffect(() => {
    if (path === null) {
      setState({ loading: false });
      return;
    }
    let stale = false; // true once a newer request replaced this one
    setState((s) => ({ data: s.data, loading: true }));
    api<T>(path)
      .then((data) => !stale && setState({ data, loading: false }))
      .catch((e: Error) => !stale && setState({ error: e.message, loading: false }));
    return () => {
      stale = true;
    };
  }, [path, reload]);
  return state;
}

// Follows a value but only after it has stopped changing for `ms` (so dragging doesn't fire a request per tick).
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Show a value in a cell.
export const fmt = (v: unknown) => (v === null || v === undefined ? "null" : String(v));

// Column names for some rows: id first, then the rest in the order they appear.
export function columns(rows: Row[]): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) names.add(key);
  names.delete("id");
  return ["id", ...names];
}
