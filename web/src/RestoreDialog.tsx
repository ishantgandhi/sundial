import { useEffect, useState } from "react";
import { api, ApiError, fmt, type PlanAction } from "./api";

// What a planned action does, as text: whole row for insert/delete, "field: old → new" lines for update.
function describe(a: PlanAction): string[] {
  if (a.type === "insert") return [JSON.stringify(a.row)];
  if (a.type === "delete") return [JSON.stringify(a.expected)];
  return Object.keys(a.row)
    .filter((k) => k !== "id" && a.row[k] !== a.expected[k])
    .map((k) => `${k}: ${fmt(a.expected[k])} → ${fmt(a.row[k])}`);
}

const KIND = { insert: "add", update: "chg", delete: "rem" } as const;

// Confirm dialog. Opening it asks the server for a plan (changes nothing); Confirm applies it.
export default function RestoreDialog({ at, ids, onClose, onDone }: { at: string; ids: number[]; onClose: () => void; onDone: (count: number) => void }) {
  const [plan, setPlan] = useState<PlanAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // ask for the plan once, when the dialog opens
  useEffect(() => {
    api<{ plan: PlanAction[] }>("/api/restore", { at, ids, apply: false })
      .then((r) => setPlan(r.plan))
      .catch((e: Error) => setError(e.message));
  }, [at, ids]);

  // Esc closes the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !applying && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, onClose]);

  async function confirm() {
    setApplying(true);
    setError(null);
    try {
      await api("/api/restore", { at, ids, apply: true });
      onDone(plan?.length ?? 0);
    } catch (e) {
      // on a conflict (409) or any other error: show it here and keep the dialog open
      setError(e instanceof ApiError && e.status === 409 ? `Conflict: ${e.message}` : (e as Error).message);
      setApplying(false);
    }
  }

  return (
    <div className="backdrop" onClick={() => !applying && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Confirm restore" onClick={(e) => e.stopPropagation()}>
        <h2>Restore to {at}</h2>
        <p className="dim">This changes your live table.</p>

        {!plan && !error && <p className="dim">Loading...</p>}
        {plan && plan.length === 0 && <p className="dim">Nothing to restore</p>}
        {plan && plan.length > 0 && (
          <ul className="plan mono">
            {plan.map((a) => (
              <li key={`${a.type}${a.id}`} className={KIND[a.type]}>
                <b className="verb">{a.type.toUpperCase()}</b> #{a.id} {describe(a).join("   ")}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button className="secondary" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button className="primary" onClick={confirm} disabled={applying || !plan || plan.length === 0}>
            {applying ? "Restoring..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
