import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronLeft, PackagePlus, Plus, X } from "lucide-react";
import {
  createEntry,
  listCompanyMeta,
  parseEntry,
  recordReturn,
  updateEntry,
  type Entry,
  type EntryDraft,
  type Payment,
  type PaymentStatus,
} from "@/lib/inventory/api";
import { companyBalances, openOrders, type OpenOrder } from "@/lib/inventory/analyse";
import { undoRecent, type UndoTarget } from "@/lib/inventory/entry-actions";
import { formatDay } from "@/lib/inventory/model";
import { rupee, splitSerials, subtotal } from "@/lib/inventory/serials";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { TypePicker } from "@/components/yard/type-picker";
import { Field } from "@/components/yard/ui";

type Mode = "give" | "take" | "exchange" | "bought";

/* ---------- opening the sheet from anywhere (Book's Edit button, empty states) ---------- */

const OPEN_EVENT = "cx:entry-sheet";
const SHOW_EVENT = "cx:show-entry";
let pendingShow: string | null = null;

export function openEntrySheet(options: { entry?: Entry; mode?: Mode } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: options }));
}

/** The Book calls this on mount to scroll to a line that was just saved. */
export function takePendingShow(): string | null {
  const id = pendingShow;
  pendingShow = null;
  return id;
}

export function onShowEntry(handler: (id: string) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener(SHOW_EVENT, listener);
  return () => window.removeEventListener(SHOW_EVENT, listener);
}

/* ---------- helpers ---------- */

const PAYMENTS: Array<{ id: PaymentStatus; label: string }> = [
  { id: "received", label: "Received" },
  { id: "partial", label: "Part received" },
  { id: "unpaid", label: "Not received" },
];

const MODES: Array<{ id: Mode; title: string; hint: string; icon: typeof Plus }> = [
  { id: "give", title: "Give cylinders", hint: "Full cylinders going out to a customer", icon: ArrowUpRight },
  { id: "take", title: "Take back", hint: "Empties coming back from a customer", icon: ArrowDownLeft },
  { id: "exchange", title: "Exchange", hint: "Empties in and full ones out, in one go", icon: ArrowLeftRight },
  { id: "bought", title: "Bought stock", hint: "Cylinders you bought from a supplier", icon: PackagePlus },
];

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function blankDraft(movement: EntryDraft["movement"] = "delivery"): EntryDraft {
  return {
    companyName: "",
    entryDate: todayISO(),
    serialNo: "",
    quantity: 0,
    paymentStatus: "unpaid",
    amountDue: null,
    amountPaid: null,
    note: "",
    movement,
    unitPrice: null,
    billNo: "",
    parentId: null,
    qtyOverride: false,
    cylinderType: "",
  };
}

function draftFrom(entry: Entry): EntryDraft {
  return {
    companyName: entry.companyName,
    entryDate: entry.entryDate,
    serialNo: entry.serialNo,
    quantity: entry.quantity,
    paymentStatus: entry.paymentStatus,
    amountDue: entry.amountDue,
    amountPaid: entry.amountPaid,
    note: entry.note,
    movement: entry.movement,
    unitPrice: entry.unitPrice,
    billNo: entry.billNo,
    parentId: entry.parentId,
    qtyOverride: splitSerials(entry.serialNo).length !== entry.quantity,
    cylinderType: entry.cylinderType,
  };
}

function moneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The parts of a draft a person types; used to ask before throwing work away. */
function fingerprint(draft: EntryDraft) {
  const note = draft.note.trim() === "Exchange" ? "" : draft.note.trim();
  return JSON.stringify([draft.companyName.trim(), draft.serialNo.trim(), draft.quantity, draft.unitPrice, draft.amountDue, draft.amountPaid, draft.billNo, draft.cylinderType, draft.paymentStatus, note, draft.entryDate]);
}

/* ---------- the launcher: + button, sheet and the "Saved" note ---------- */

type Toast = { text: string; undo: UndoTarget[]; entryId: string | null };

export function EntryLauncher({
  entries,
  payments,
  cylinderTypes,
  onChanged,
  onShowBook,
}: {
  entries: Entry[];
  payments: Payment[];
  cylinderTypes: string[];
  onChanged: () => void;
  onShowBook: () => void;
}) {
  const { canEdit } = useRole();
  const [sheet, setSheet] = useState<{ key: number; mode: Mode | null; entry: Entry | null } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [undoNote, setUndoNote] = useState("");
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ entry?: Entry; mode?: Mode }>).detail ?? {};
      setSheet({ key: Date.now(), mode: detail.entry ? null : (detail.mode ?? null), entry: detail.entry ?? null });
    };
    window.addEventListener(OPEN_EVENT, listener);
    return () => window.removeEventListener(OPEN_EVENT, listener);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 15000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!canEdit) return null;

  async function undo() {
    if (!toast) return;
    setUndoing(true);
    try {
      const result = await undoRecent({ data: toast.undo });
      setUndoNote(result.ok ? "Undone. The line is in Settings → Recently deleted." : result.error);
      if (result.ok) setToast(null);
      onChanged();
    } catch {
      setUndoNote("Couldn't undo. Check your internet connection.");
    } finally {
      setUndoing(false);
      window.setTimeout(() => setUndoNote(""), 6000);
    }
  }

  return (
    <>
      {!sheet ? (
        <button
          type="button"
          className="no-print btn btn-rust fixed bottom-[5.25rem] right-4 z-30 h-14 gap-2 rounded-full px-5 text-base shadow-lg shadow-ink/25 lg:bottom-8 lg:right-8"
          onClick={() => setSheet({ key: Date.now(), mode: null, entry: null })}
        >
          <Plus className="size-5" aria-hidden />
          New entry
        </button>
      ) : null}

      {toast || undoNote ? (
        <div className="no-print fixed inset-x-4 bottom-[9.5rem] z-40 mx-auto max-w-md lg:bottom-28 lg:left-auto lg:right-8" role="status">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-ink px-4 py-3 text-sm text-paper shadow-lg">
            <span className="min-w-0 flex-1">{toast ? toast.text : undoNote}</span>
            {toast ? (
              <>
                {toast.entryId !== undefined ? (
                  <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => {
                      pendingShow = toast.entryId;
                      onShowBook();
                      if (toast.entryId) window.setTimeout(() => window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: toast.entryId })), 50);
                      setToast(null);
                    }}
                  >
                    View in book
                  </button>
                ) : null}
                {toast.undo.length ? (
                  <button type="button" className="font-semibold underline" disabled={undoing} onClick={() => void undo()}>
                    {undoing ? "Undoing…" : "Undo"}
                  </button>
                ) : null}
                <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-paper/15" aria-label="Dismiss" onClick={() => setToast(null)}>
                  <X className="size-4" aria-hidden />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {sheet ? (
        <EntrySheet
          key={sheet.key}
          initialMode={sheet.mode}
          editing={sheet.entry}
          entries={entries}
          payments={payments}
          cylinderTypes={cylinderTypes}
          onClose={() => setSheet(null)}
          onSaved={(result) => {
            setSheet(null);
            setUndoNote("");
            setToast(result);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- the sheet ---------- */

type Picks = Record<string, string[]>;
type Counts = Record<string, number>;

function EntrySheet({
  initialMode,
  editing,
  entries,
  payments,
  cylinderTypes,
  onClose,
  onSaved,
}: {
  initialMode: Mode | null;
  editing: Entry | null;
  entries: Entry[];
  payments: Payment[];
  cylinderTypes: string[];
  onClose: () => void;
  onSaved: (toast: Toast) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(editing ? (editing.movement === "purchase" ? "bought" : "give") : initialMode);
  const [draft, setDraft] = useState<EntryDraft>(() =>
    editing ? draftFrom(editing) : blankDraft(initialMode === "bought" ? "purchase" : "delivery"),
  );
  const [finalTouched, setFinalTouched] = useState(() =>
    editing ? editing.unitPrice != null && editing.amountDue !== subtotal(editing.quantity, editing.unitPrice) : false,
  );
  const [picks, setPicks] = useState<Picks>({});
  const [counts, setCounts] = useState<Counts>({});
  const [backNote, setBackNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });

  const names = useMemo(() => [...new Set(entries.map((entry) => entry.companyName))].sort(), [entries]);
  const allOrders = useMemo(() => openOrders(entries), [entries]);
  const outNames = useMemo(() => [...new Set(allOrders.map((order) => order.entry.companyName))].sort(), [allOrders]);
  const orders = useMemo(() => allOrders.filter((order) => same(order.entry.companyName, draft.companyName)), [allOrders, draft.companyName]);
  const balance = useMemo(
    () => companyBalances(entries, payments).find((row) => same(row.company, draft.companyName)),
    [entries, payments, draft.companyName],
  );

  const takesBack = mode === "take" || mode === "exchange";
  const givesOut = mode === "give" || mode === "exchange" || mode === "bought";
  const backTotal = orders.reduce((sum, order) => sum + (order.leftSerials.length ? (picks[order.entry.id]?.length ?? 0) : (counts[order.entry.id] ?? 0)), 0);
  const [initial] = useState(() => fingerprint(draft));
  const dirty = fingerprint(draft) !== initial || backTotal > 0;

  // Keep the page behind still, and close on Escape.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role=menu][aria-hidden="false"]')) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [mode]);

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function choose(next: Mode) {
    setMode(next);
    setError("");
    setDraft((current) => ({
      ...current,
      movement: next === "bought" ? "purchase" : "delivery",
      note: next === "exchange" && !current.note ? "Exchange" : current.note === "Exchange" && next !== "exchange" ? "" : current.note,
    }));
  }

  /** This company's saved rate for a gas type, else the last price charged to them for it. */
  function knownPrice(company: string, type: string): number | null {
    if (!company.trim() || !type.trim()) return null;
    const rates = metaQuery.data?.find((row) => same(row.companyName, company))?.prices ?? {};
    const rate = Object.entries(rates).find(([key]) => same(key, type))?.[1];
    if (rate != null) return rate;
    let last: Entry | null = null;
    for (const entry of entries) {
      if (entry.unitPrice == null || entry.movement === "return" || !same(entry.companyName, company) || !same(entry.cylinderType, type)) continue;
      if (!last || entry.entryDate > last.entryDate) last = entry;
    }
    return last?.unitPrice ?? null;
  }

  function withType(base: EntryDraft, cylinderType: string): EntryDraft {
    const price = base.unitPrice == null && base.movement === "delivery" ? knownPrice(base.companyName, cylinderType) : null;
    return price != null
      ? { ...base, cylinderType, unitPrice: price, amountDue: finalTouched ? base.amountDue : subtotal(base.quantity, price) }
      : { ...base, cylinderType };
  }

  function backPicks() {
    return orders
      .map((order) => ({
        order,
        serials: order.leftSerials.length ? (picks[order.entry.id] ?? []) : [],
        quantity: order.leftSerials.length ? (picks[order.entry.id]?.length ?? 0) : (counts[order.entry.id] ?? 0),
      }))
      .filter((row) => row.quantity > 0);
  }

  async function save() {
    setError("");
    if (!mode) return;
    if (!draft.companyName.trim()) {
      setError("Enter the company name.");
      return;
    }
    const giving = givesOut ? parseEntry(draft) : null;
    if (giving && !giving.ok) {
      setError(giving.error);
      return;
    }
    const back = takesBack ? backPicks() : [];
    if (takesBack && !back.length) {
      setError(orders.length ? "Tick the cylinders that came back." : `No cylinders are out with ${draft.companyName.trim()}.`);
      return;
    }
    setBusy(true);
    try {
      const undo: UndoTarget[] = [];
      for (const row of back) {
        const result = await recordReturn({
          data: { entryId: row.order.entry.id, serials: row.serials, quantity: row.quantity, note: backNote || (mode === "exchange" ? "Exchange" : "") },
        });
        if (!result.ok) {
          setError(undo.length ? `Some cylinders were taken back, but not all: ${result.error}` : result.error);
          return;
        }
        undo.push({ kind: "return", parentId: row.order.entry.id });
      }
      const company = draft.companyName.trim();
      const backQty = back.reduce((sum, row) => sum + row.quantity, 0);
      if (!giving) {
        onSaved({ text: `${backQty} cylinder${backQty === 1 ? "" : "s"} taken back from ${company}.`, undo, entryId: null });
        return;
      }
      if (editing) {
        const result = await updateEntry({ data: { ...giving.value, id: editing.id } });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onSaved({ text: `Changes saved for ${company}.`, undo: [], entryId: editing.id });
        return;
      }
      const result = await createEntry({ data: giving.value });
      if (!result.ok) {
        if (undo.length) {
          // The empties are already back; keep the form so the full cylinders can still be saved.
          setPicks({});
          setCounts({});
          setMode(draft.movement === "purchase" ? "bought" : "give");
          setError(`The empties were taken back. The full cylinders weren't saved yet: ${result.error}`);
        } else {
          setError(result.error);
        }
        return;
      }
      const qty = giving.value.quantity;
      const text =
        mode === "exchange"
          ? `Exchange saved: ${backQty} back, ${qty} out to ${company}.`
          : mode === "bought"
            ? `${qty} cylinder${qty === 1 ? "" : "s"} bought from ${company} saved.`
            : `${qty} cylinder${qty === 1 ? "" : "s"} given to ${company} saved.`;
      onSaved({ text, undo: [...undo, { kind: "entry", id: result.entry.id }], entryId: result.entry.id });
    } catch {
      setError("Could not save. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? "Edit entry" : mode ? MODES.find((item) => item.id === mode)!.title : "New entry";
  const saveLabel = editing
    ? "Save changes"
    : mode === "take"
      ? backTotal
        ? `Take back ${backTotal} cylinder${backTotal === 1 ? "" : "s"}`
        : "Take back"
      : mode === "exchange"
        ? "Save exchange"
        : "Add to the book";

  return (
    <div className="no-print fixed inset-0 z-50 flex lg:items-center lg:justify-center lg:bg-ink/40 lg:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex h-full w-full flex-col bg-paper lg:h-auto lg:max-h-[90vh] lg:max-w-2xl lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line bg-card px-2 py-2 sm:px-3">
          {mode && !editing ? (
            <button type="button" className="grid size-11 place-items-center rounded-lg hover:bg-sand" aria-label="Back to the choices" onClick={() => setMode(null)}>
              <ChevronLeft className="size-5" aria-hidden />
            </button>
          ) : (
            <span className="w-2" />
          )}
          <h2 className="min-w-0 flex-1 truncate font-display text-2xl">{title}</h2>
          <button type="button" className="grid size-11 place-items-center rounded-lg hover:bg-sand" aria-label="Close" onClick={requestClose}>
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {confirmClose ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sand px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{editing ? "Close without saving your changes?" : "Throw away this entry?"}</span>
            <button type="button" className="btn btn-rust h-9 px-3 text-sm" onClick={onClose}>
              {editing ? "Close" : "Discard"}
            </button>
            <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => setConfirmClose(false)}>
              Keep editing
            </button>
          </div>
        ) : null}

        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {!mode ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted">What&apos;s happening?</p>
              <div className="grid grid-cols-2 gap-3">
                {MODES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="flex min-h-32 flex-col items-start gap-2 rounded-xl border border-line bg-card p-4 text-left transition hover:border-pine hover:bg-sand focus-visible:border-pine"
                      onClick={() => choose(item.id)}
                    >
                      <span className={cn("grid size-10 place-items-center rounded-full", item.id === "take" ? "bg-pine text-pine-fg" : item.id === "bought" ? "bg-sand text-ink" : "bg-rust text-rust-fg")}>
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="font-semibold leading-tight">{item.title}</span>
                      <span className="text-xs leading-snug text-muted">{item.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={mode === "bought" ? "Supplier" : "Company name"}>
                  <input
                    className="field"
                    value={draft.companyName}
                    list={takesBack ? "sheet-out-names" : "sheet-names"}
                    onChange={(event) => {
                      setDraft({ ...draft, companyName: event.target.value });
                      setPicks({});
                      setCounts({});
                    }}
                    placeholder="Sharma Stores"
                    autoFocus={!editing}
                  />
                  <datalist id="sheet-names">
                    {names.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <datalist id="sheet-out-names">
                    {outNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Date" hint={takesBack && !givesOut ? "Take-backs are dated today." : undefined}>
                  <input type="date" className="field" value={draft.entryDate} disabled={takesBack && !givesOut} onChange={(event) => setDraft({ ...draft, entryDate: event.target.value })} />
                </Field>
              </div>

              {balance && draft.companyName.trim() ? (
                <p className="rounded-lg bg-sand px-3 py-2 text-sm">
                  <span className="font-semibold">{balance.company}</span> has {balance.outstandingQty} cylinder{balance.outstandingQty === 1 ? "" : "s"} out
                  {balance.toCollect ? ` · ${rupee(balance.toCollect, 0)} to collect` : ""}.
                </p>
              ) : null}

              {takesBack ? (
                <Section title={mode === "exchange" ? "Empties coming back" : "Cylinders coming back"} tone="pine">
                  <TakeBackFields
                    company={draft.companyName}
                    orders={orders}
                    picks={picks}
                    counts={counts}
                    onPicks={setPicks}
                    onCounts={setCounts}
                    note={backNote}
                    onNote={setBackNote}
                    showNote={mode === "take"}
                  />
                </Section>
              ) : null}

              {givesOut ? (
                <Section title={mode === "exchange" ? "Full cylinders going out" : mode === "bought" ? "What you bought" : editing ? "Line" : "Cylinders going out"} tone={mode === "bought" ? undefined : "rust"} plain={mode !== "exchange"}>
                  <LineFields
                    draft={draft}
                    setDraft={setDraft}
                    finalTouched={finalTouched}
                    setFinalTouched={setFinalTouched}
                    cylinderTypes={cylinderTypes}
                    onType={(type) => setDraft(withType(draft, type))}
                    typeHint={mode === "exchange" && !draft.cylinderType ? orders[0]?.entry.cylinderType : undefined}
                    onUseHint={(type) => setDraft(withType(draft, type))}
                  />
                </Section>
              ) : null}
            </div>
          )}
        </div>

        {mode ? (
          <footer className="border-t border-line bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
            {error ? (
              <p role="alert" className="mb-2 text-sm text-rust">
                {error}
              </p>
            ) : null}
            <button type="button" className="btn btn-rust h-12 w-full text-base" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : saveLabel}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, tone, plain, children }: { title: string; tone?: "pine" | "rust"; plain?: boolean; children: ReactNode }) {
  if (plain) return <div className="grid gap-3">{children}</div>;
  return (
    <section className={cn("rounded-xl border bg-card p-3 sm:p-4", tone === "pine" ? "border-pine/40" : tone === "rust" ? "border-rust/40" : "border-line")}>
      <h3 className={cn("mb-3 text-xs font-bold uppercase tracking-wider", tone === "pine" ? "text-pine" : "text-rust")}>{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

/* ---------- take back: tick serials on the company's open deliveries ---------- */

function TakeBackFields({
  company,
  orders,
  picks,
  counts,
  onPicks,
  onCounts,
  note,
  onNote,
  showNote,
}: {
  company: string;
  orders: OpenOrder[];
  picks: Picks;
  counts: Counts;
  onPicks: (next: Picks) => void;
  onCounts: (next: Counts) => void;
  note: string;
  onNote: (value: string) => void;
  showNote: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [typedNote, setTypedNote] = useState("");

  if (!company.trim()) return <p className="text-sm text-muted">Enter the company first. Their open deliveries show up here.</p>;
  if (!orders.length) return <p className="text-sm text-muted">No cylinders are out with {company.trim()} right now.</p>;

  const toggle = (orderId: string, serial: string) => {
    const current = picks[orderId] ?? [];
    onPicks({ ...picks, [orderId]: current.includes(serial) ? current.filter((item) => item !== serial) : [...current, serial] });
  };

  function tickTyped() {
    const wanted = splitSerials(typed);
    if (!wanted.length) return;
    const next: Picks = { ...picks };
    const found = new Set<string>();
    for (const order of orders) {
      for (const serial of order.leftSerials) {
        if (wanted.some((item) => same(item, serial))) {
          next[order.entry.id] = [...new Set([...(next[order.entry.id] ?? []), serial])];
          found.add(serial.toLowerCase());
        }
      }
    }
    const missing = wanted.filter((item) => !found.has(item.toLowerCase()));
    onPicks(next);
    setTyped("");
    setTypedNote(missing.length ? `Not out with ${company.trim()}: ${missing.join(", ")}` : `Ticked ${wanted.length}.`);
  }

  const withSerials = orders.some((order) => order.leftSerials.length);

  return (
    <>
      {withSerials ? (
        <div>
          <div className="flex gap-2">
            <input
              className="field"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  tickTyped();
                }
              }}
              placeholder="Type serials to tick them"
              aria-label="Type serials to tick them"
            />
            <button type="button" className="btn btn-ghost shrink-0" onClick={tickTyped}>
              Tick
            </button>
          </div>
          {typedNote ? <p className="mt-1 text-xs text-muted">{typedNote}</p> : null}
        </div>
      ) : null}
      {orders.map((order) => {
        const chosen = picks[order.entry.id] ?? [];
        const all = order.leftSerials.length > 0 && chosen.length === order.leftSerials.length;
        return (
          <div key={order.entry.id} className="rounded-lg border border-line bg-paper/60 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {formatDay(order.entry.entryDate)}
                {order.entry.cylinderType ? ` · ${order.entry.cylinderType}` : ""}
                {order.entry.billNo ? <span className="font-normal text-muted"> · {order.entry.billNo}</span> : null}
              </p>
              <p className="text-xs text-muted">{order.leftQty} still out</p>
            </div>
            {order.leftSerials.length ? (
              <>
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-pine underline"
                  onClick={() => onPicks({ ...picks, [order.entry.id]: all ? [] : [...order.leftSerials] })}
                >
                  {all ? "Clear" : "Tick all"}
                </button>
                <div className="mt-2 flex flex-wrap gap-2">
                  {order.leftSerials.map((serial) => {
                    const on = chosen.includes(serial);
                    return (
                      <button
                        key={serial}
                        type="button"
                        aria-pressed={on}
                        className={cn("min-h-10 rounded-lg border px-3 text-sm tabular-nums", on ? "border-pine bg-pine text-pine-fg" : "border-line bg-card")}
                        onClick={() => toggle(order.entry.id, serial)}
                      >
                        {on ? "✓ " : ""}
                        {serial}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <Field label="How many came back" hint={`Up to ${order.leftQty}. This delivery has no serials.`}>
                <input
                  className="field w-32 tabular-nums"
                  inputMode="numeric"
                  value={counts[order.entry.id] ? String(counts[order.entry.id]) : ""}
                  placeholder="0"
                  onChange={(event) => onCounts({ ...counts, [order.entry.id]: Math.min(order.leftQty, Number(event.target.value.replace(/[^\d]/g, "") || "0")) })}
                />
              </Field>
            )}
          </div>
        );
      })}
      {showNote ? (
        <Field label="Note">
          <input className="field" value={note} maxLength={300} onChange={(event) => onNote(event.target.value)} placeholder="Optional" />
        </Field>
      ) : null}
    </>
  );
}

/* ---------- give / bought: one line of cylinders with price and payment ---------- */

function LineFields({
  draft,
  setDraft,
  finalTouched,
  setFinalTouched,
  cylinderTypes,
  onType,
  typeHint,
  onUseHint,
}: {
  draft: EntryDraft;
  setDraft: (draft: EntryDraft) => void;
  finalTouched: boolean;
  setFinalTouched: (value: boolean) => void;
  cylinderTypes: string[];
  onType: (type: string) => void;
  typeHint?: string;
  onUseHint: (type: string) => void;
}) {
  const counted = splitSerials(draft.serialNo).length;
  const lineSubtotal = subtotal(draft.quantity, draft.unitPrice);
  const isReturn = draft.movement === "return";

  function applySerials(serialNo: string) {
    const quantity = draft.qtyOverride ? draft.quantity : splitSerials(serialNo).length;
    setDraft({ ...draft, serialNo, quantity, amountDue: finalTouched ? draft.amountDue : subtotal(quantity, draft.unitPrice) });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TypePicker value={draft.cylinderType} types={cylinderTypes} onChange={onType} />
        {typeHint ? (
          <button type="button" className="mt-1 text-xs font-semibold text-pine underline" onClick={() => onUseHint(typeHint)}>
            Same as the empties: {typeHint}
          </button>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <Field label="Cylinder serial no." hint={counted ? `${counted} unique serial${counted === 1 ? "" : "s"} counted.` : "One per line, or separated by commas."}>
          <textarea className="field field-area min-h-24" value={draft.serialNo} onChange={(event) => applySerials(event.target.value)} placeholder={"S-44101\nS-44102"} />
        </Field>
      </div>
      <Field label="No. of cylinders" hint={draft.qtyOverride ? "Manual count." : "Counted from the serials."}>
        <input
          className={cn("field tabular-nums", !draft.qtyOverride && "bg-sand")}
          inputMode="numeric"
          readOnly={!draft.qtyOverride}
          value={String(draft.quantity)}
          onChange={(event) => {
            const quantity = Number(event.target.value.replace(/[^\d]/g, "") || "0");
            setDraft({ ...draft, quantity, amountDue: finalTouched ? draft.amountDue : subtotal(quantity, draft.unitPrice) });
          }}
        />
      </Field>
      <div className="flex items-end">
        <button
          type="button"
          role="switch"
          aria-checked={draft.qtyOverride}
          className="btn btn-ghost w-full justify-between"
          onClick={() => {
            const qtyOverride = !draft.qtyOverride;
            const quantity = qtyOverride ? draft.quantity || counted || 1 : counted;
            setDraft({ ...draft, qtyOverride, quantity, amountDue: finalTouched ? draft.amountDue : subtotal(quantity, draft.unitPrice) });
          }}
        >
          Type the count myself
          <span className={cn("inline-flex h-7 w-12 items-center rounded-full p-1", draft.qtyOverride ? "bg-pine" : "bg-line")}>
            <span className={cn("size-5 rounded-full bg-card", draft.qtyOverride && "ml-auto")} />
          </span>
        </button>
      </div>
      {isReturn ? null : (
        <>
          <Field label="Price per cylinder (₹)">
            <input
              className="field tabular-nums"
              inputMode="decimal"
              value={draft.unitPrice ?? ""}
              placeholder="0"
              onChange={(event) => {
                const unitPrice = moneyInput(event.target.value);
                setDraft({ ...draft, unitPrice, amountDue: finalTouched ? draft.amountDue : subtotal(draft.quantity, unitPrice) });
              }}
            />
          </Field>
          <div className="rounded-xl border border-line bg-sand px-4 py-3 text-sm">
            <p>Subtotal {rupee(lineSubtotal)}</p>
            <p className="text-muted">Quantity × price.</p>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Payment</legend>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENTS.map((payment) => (
                <button
                  key={payment.id}
                  type="button"
                  className={cn("btn px-2 text-xs sm:text-sm", draft.paymentStatus === payment.id ? "btn-pine" : "btn-ghost")}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      paymentStatus: payment.id,
                      amountPaid: payment.id === "received" && draft.amountPaid == null ? draft.amountDue : draft.amountPaid,
                    })
                  }
                >
                  {payment.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Final amount (₹)" hint="Change it for a round-off.">
            <input
              className="field tabular-nums"
              inputMode="decimal"
              value={draft.amountDue ?? ""}
              placeholder="0"
              onChange={(event) => {
                setFinalTouched(true);
                setDraft({ ...draft, amountDue: moneyInput(event.target.value) });
              }}
            />
          </Field>
          {draft.paymentStatus !== "unpaid" ? (
            <Field label="Amount received (₹)">
              <input className="field tabular-nums" inputMode="decimal" value={draft.amountPaid ?? ""} placeholder="0" onChange={(event) => setDraft({ ...draft, amountPaid: moneyInput(event.target.value) })} />
            </Field>
          ) : (
            <span className="hidden sm:block" />
          )}
          <Field label="Bill no.">
            <input className="field" value={draft.billNo} maxLength={40} onChange={(event) => setDraft({ ...draft, billNo: event.target.value })} />
          </Field>
        </>
      )}
      <Field label="Note">
        <input className="field" value={draft.note} maxLength={300} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
      </Field>
    </div>
  );
}
