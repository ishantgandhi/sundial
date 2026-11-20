import { useEffect, useMemo, useState } from "react";
import { FAR_FUTURE, fmt, useApi, useDebounced, type Change, type Diff, type Row, type Tick } from "./api";
import Slider from "./Slider";
import RestoreDialog from "./RestoreDialog";
import { DiffList, TableAt, diffIds } from "./Tables";

const TABLE = "orders";

// One line per change inside a tick: action, row id, and the values.
function describeChange(c: Change): string {
  if (c.action === "insert") return JSON.stringify(c.new_row);
  if (c.action === "delete") return JSON.stringify(c.old_row);
  const keys = Object.keys(c.new_row ?? {}).filter((k) => c.old_row?.[k] !== c.new_row?.[k]);
  return keys.map((k) => `${k}: ${fmt(c.old_row?.[k])} → ${fmt(c.new_row?.[k])}`).join("   ");
}

// Content that dims a little (after a short wait) while fresh data loads, instead of being replaced by "Loading...".
const fade = (s: { loading: boolean; data?: unknown }) => (s.loading && s.data ? "fade stale" : "fade");

export default function App() {
  const [reload, setReload] = useState(0); // add 1 to load everything again
  const [selected, setSelected] = useState<string | null>(null); // lsn under the slider handle; null = Now
  const settled = useDebounced(selected, 120); // the choice the data loads for, once the handle stops moving
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState(false);
  const [message, setMessage] = useState("");

  // the live table reloads by itself every few seconds
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLiveTick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, []);
  const live = useApi<Row[]>("/api/live", reload + liveTick);

  const ticksState = useApi<Tick[]>("/api/ticks", reload);
  const ticks = ticksState.data ?? [];
  // a tick that no longer exists (or none chosen) means Now, which sits after the last tick
  const indexOf = (lsn: string | null) => {
    const i = ticks.findIndex((t) => t.lsn === lsn);
    return i === -1 ? ticks.length : i;
  };
  const index = indexOf(selected); // where the handle is
  const tick: Tick | undefined = ticks[indexOf(settled)]; // which tick the data below belongs to
  const isNow = !tick;
  const at = tick ? tick.committedAt : FAR_FUTURE; // the exact time string goes back to the server

  const q = encodeURIComponent;
  const table = useApi<Row[]>(ticksState.data ? `/api/table?at=${q(at)}` : null, reload);
  const diff = useApi<Diff>(ticksState.data && !isNow ? `/api/compare?at=${q(at)}` : null, reload);
  const changes = useApi<Change[]>(tick ? `/api/changes?lsn=${q(tick.lsn)}` : null, reload);

  // every time a new diff arrives, tick all its rows
  useEffect(() => {
    setChecked(new Set(diff.data ? diffIds(diff.data) : []));
  }, [diff.data]);

  // the checked row ids, in a stable order (the dialog asks the server again if this changes)
  const ids = useMemo(() => [...checked].sort((a, b) => a - b), [checked]);

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <main>
      <header>
        <h1>Sundial</h1>
        <span className="mono dim">{TABLE}</span>
      </header>

      <div className="layout">
        <div className="main-col">
      <div className="cols">
        <section>
          <h2>
            Table {isNow ? "now" : "at"} {!isNow && <span className="mono dim">{at}</span>}
          </h2>
          {table.loading && !table.data && <p className="dim">Loading...</p>}
          {table.error && <p className="error">{table.error}</p>}
          {table.data && (
            <div className={fade(table)}>
              <TableAt rows={table.data} diff={diff.data} />
            </div>
          )}
        </section>

        {!isNow && (
          <section>
            <div className="row-between">
              <h2>Changes since then</h2>
              <button className="primary" disabled={ids.length === 0 || diff.loading} onClick={() => setDialog(true)}>
                Restore {ids.length} {ids.length === 1 ? "row" : "rows"}
              </button>
            </div>
            {message && <p className="notice">{message}</p>}
            {diff.loading && !diff.data && <p className="dim">Loading...</p>}
            {diff.error && <p className="error">{diff.error}</p>}
            {diff.data && (
              <div className={fade(diff)}>
                <DiffList diff={diff.data} checked={checked} onToggle={toggle} />
              </div>
            )}
          </section>
        )}
      </div>

      {/* always takes up room, so the tables below don't jump when you move to or from Now */}
      <section className="changes">
        <h2>Changes in this transaction</h2>
        {!tick && <p className="dim">Now is the live table. Move the slider to see a transaction.</p>}
        {tick && changes.loading && !changes.data && <p className="dim">Loading...</p>}
        {tick && changes.error && <p className="error">{changes.error}</p>}
        {tick && changes.data && (
          <ul className={`mono ${fade(changes)}`}>
            {changes.data.map((c) => (
              <li key={c.id}>
                <b className="verb">{c.action}</b> #{c.row_key.id} {describeChange(c)}
              </li>
            ))}
          </ul>
        )}
      </section>

        </div>

        {/* the live table, always visible on the side */}
        <aside className="live">
          <h2>Live table</h2>
          {live.error && <p className="error">{live.error}</p>}
          {live.data ? <TableAt rows={live.data} /> : !live.error && <p className="dim">Loading...</p>}
        </aside>
      </div>

      <section className="time">
        <div className="row-between">
          <h2>Time</h2>
          <button className="link" onClick={() => setReload((n) => n + 1)}>
            Refresh
          </button>
        </div>
        {ticksState.loading && !ticksState.data && <p className="dim">Loading...</p>}
        {ticksState.error && <p className="error">{ticksState.error}</p>}
        {ticksState.data && (
          <>
            <Slider
              ticks={ticks}
              index={index}
              onChange={(i) => {
                setSelected(ticks[i]?.lsn ?? null);
                setMessage("");
              }}
            />
            {ticks.length === 0 && <p className="dim">No history yet</p>}
          </>
        )}
      </section>

      {dialog && (
        <RestoreDialog
          at={at}
          ids={ids}
          onClose={() => setDialog(false)}
          onDone={(count) => {
            setDialog(false);
            setMessage(`Restored ${count} ${count === 1 ? "row" : "rows"}.`);
            setReload((n) => n + 1); // load ticks, table and diff again
          }}
        />
      )}
    </main>
  );
}
