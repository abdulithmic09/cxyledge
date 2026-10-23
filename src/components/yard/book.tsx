import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, CloudOff, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import {
  deleteEntry,
  listMembers,
  restoreDeleted,
  seedSample,
  type Entry,
  type Payment,
  type PaymentStatus,
  type ReturnLog,
} from "@/lib/inventory/api";
import { companyBalances, movementLabel, paymentLabel } from "@/lib/inventory/analyse";
import { formatDay } from "@/lib/inventory/model";
import { rupee } from "@/lib/inventory/serials";
import { cn } from "@/lib/cn";
import { PageHead, Tally } from "@/components/yard/ui";
import { useRole } from "@/lib/inventory/role";
import { onShowEntry, openEntrySheet, takePendingShow } from "@/components/yard/entry-launcher";
import { useOutbox } from "@/lib/inventory/outbox";

type Kind = "all" | "delivery" | "return" | "purchase";
type When = "all" | "today" | "week" | "month";

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "all", label: "All" },
  { id: "delivery", label: "Given" },
  { id: "return", label: "Returned" },
  { id: "purchase", label: "Bought" },
];

const WORD: Record<string, string> = { delivery: "Given", return: "Returned", purchase: "Bought" };

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sinceFor(when: When): string {
  const now = new Date();
  if (when === "today") return isoDay(now);
  if (when === "week") return isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  if (when === "month") return isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  return "";
}

const PAYMENTS: Array<{ id: PaymentStatus; label: string }> = [
  { id: "received", label: "Received" },
  { id: "partial", label: "Part received" },
  { id: "unpaid", label: "Not received" },
];

export function BookView({
  entries,
  payments,
  userId,
  yardId,
  onChanged,
  syncedAt,
}: {
  entries: Entry[];
  payments: Payment[];
  cylinderTypes?: string[];
  userId: string;
  yardId?: string;
  logs?: ReturnLog[];
  onChanged: () => void;
  syncedAt: number;
}) {
  const { canEdit, isOwner } = useRole();
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentStatus | "all">("all");
  const [kind, setKind] = useState<Kind>("all");
  const [when, setWhen] = useState<When>("all");
  const waiting = useOutbox(yardId);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => listMembers(), refetchInterval: 30000 });
  const memberName = useMemo(() => new Map((membersQuery.data ?? []).map((m) => [m.userId, m.name])), [membersQuery.data]);

  const remove = useMutation({
    mutationFn: (entry: Entry) => deleteEntry({ data: entry.id }).then((result) => ({ result, entry })),
    onSuccess: ({ result, entry }) => {
      setPendingDelete(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUndo({ id: entry.id, label: `${entry.companyName} · ${formatDay(entry.entryDate)}` });
      onChanged();
    },
    onError: () => setError("Could not delete. Check your internet connection."),
  });

  const restore = useMutation({
    mutationFn: (id: string) => restoreDeleted({ data: { kind: "entry", id } }),
    onSuccess: (result) => {
      setUndo(null);
      if (!result.ok) setError(result.error);
      onChanged();
    },
  });

  const sample = useMutation({
    mutationFn: () => seedSample(),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged();
    },
  });

  const balances = useMemo(() => companyBalances(entries, payments), [entries, payments]);
  const stillOut = balances.reduce((total, row) => total + row.outstandingQty, 0);
  const toCollect = balances.reduce((total, row) => total + row.toCollect, 0);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const since = sinceFor(when);
    return entries.filter((entry) => {
      if (kind !== "all" && entry.movement !== kind) return false;
      if (since && entry.entryDate < since) return false;
      if (filter !== "all" && (entry.movement === "return" || entry.paymentStatus !== filter)) return false;
      if (!needle) return true;
      return [entry.companyName, entry.serialNo, entry.note, entry.billNo, entry.movement, paymentLabel(entry.paymentStatus)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, filter, query, kind, when]);
  // Long books render in pages so the phone stays quick.
  const [limit, setLimit] = useState(60);

  const synced = syncedAt ? new Date(syncedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

  // "View in book" after saving: scroll to the new line and highlight it for a moment.
  useEffect(() => {
    const show = (id: string) => {
      setQuery("");
      setFilter("all");
      setKind("all");
      setWhen("all");
      setFlash(id);
      setExpanded(id);
      window.setTimeout(() => document.getElementById(`entry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
      window.setTimeout(() => setFlash(null), 2600);
    };
    const pending = takePendingShow();
    if (pending) show(pending);
    return onShowEntry(show);
  }, []);

  const visible = shown.slice(0, limit);
  const days: Array<{ day: string; rows: Entry[] }> = [];
  for (const entry of visible) {
    const last = days[days.length - 1];
    if (last && last.day === entry.entryDate) last.rows.push(entry);
    else days.push({ day: entry.entryDate, rows: [entry] });
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Book" detail={`${entries.length} ${entries.length === 1 ? "line" : "lines"}${synced ? ` · synced ${synced}` : ""}`} />

      {undo ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm" role="status">
          <span className="min-w-0 flex-1">Deleted {undo.label}. Kept in Settings → Recently deleted for 30 days.</span>
          <button type="button" className="font-semibold text-brand" disabled={restore.isPending} onClick={() => restore.mutate(undo.id)}>
            Undo
          </button>
          <button type="button" className="text-muted" onClick={() => setUndo(null)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-rust/30 bg-rust/5 px-3.5 py-2.5 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <Tally
        items={[
          { label: "Out with customers", value: stillOut },
          { label: "To collect", value: rupee(toCollect, 0), tone: toCollect > 0 ? "rust" : undefined },
        ]}
      />

      {waiting.length ? (
        <div className="rounded-lg border border-dashed border-line bg-card px-3.5 py-2.5 text-sm" role="status">
          <p className="flex items-center gap-2 font-semibold">
            <CloudOff className="size-4 text-muted" aria-hidden /> {waiting.length} waiting for internet
          </p>
          <ul className="mt-1 text-muted">
            {waiting.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">Saved on this phone. They go into the book by themselves once you&apos;re back online.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-2 lg:max-w-md">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input className="field pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, serial or bill no." aria-label="Search entries" />
          </div>
          <select className="field w-auto shrink-0" value={when} onChange={(event) => setWhen(event.target.value as When)} aria-label="Date">
            <option value="all">Any date</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">This month</option>
          </select>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max items-center gap-2">
            <div className="seg" role="group" aria-label="Type">
              {KINDS.map((item) => (
                <button key={item.id} type="button" aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <select className="field !h-9 w-auto text-sm" value={filter} onChange={(event) => setFilter(event.target.value as PaymentStatus | "all")} aria-label="Payment">
              <option value="all">Any payment</option>
              {PAYMENTS.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card px-4 py-8 text-center">
          <p className="text-sm text-muted">{entries.length === 0 ? "Nothing in the book yet." : "Nothing matches these filters."}</p>
          {entries.length === 0 && canEdit ? (
            <button type="button" className="btn btn-rust mt-3 gap-2" onClick={() => openEntrySheet()}>
              <Plus className="size-4" aria-hidden /> New entry
            </button>
          ) : null}
          {entries.length === 0 && isOwner ? (
            <button type="button" className="btn btn-ghost ml-2 mt-3" disabled={sample.isPending} onClick={() => sample.mutate()}>
              {sample.isPending ? "Adding…" : "Add a sample week"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="-mx-4 border-y border-line bg-card sm:mx-0 sm:rounded-lg sm:border">
          <div className="label hidden grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1.6fr)_7.5rem_7rem] gap-3 border-b border-line px-4 py-2 lg:grid">
            <span />
            <span>Company</span>
            <span>Cylinders</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Status</span>
          </div>
          {days.map((group) => (
            <section key={group.day} aria-label={formatDay(group.day)}>
              <h3 className="label sticky top-14 z-[1] border-b border-line bg-sand px-4 py-1.5">{formatDay(group.day)}</h3>
              <ul>
                {group.rows.map((entry) => {
                  const isReturn = entry.movement === "return";
                  const parent = isReturn && entry.parentId ? byId.get(entry.parentId) : undefined;
                  const serials = entry.serialNo.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
                  const open = expanded === entry.id;
                  const Glyph = entry.movement === "return" ? ArrowDownLeft : entry.movement === "purchase" ? PackagePlus : ArrowUpRight;
                  const status = isReturn ? "Returned" : entry.movement === "purchase" ? (entry.paymentStatus === "received" ? "Paid" : entry.paymentStatus === "partial" ? "Part paid" : "Not paid") : paymentLabel(entry.paymentStatus);
                  return (
                    <li key={entry.id} id={`entry-${entry.id}`} className={cn("border-b border-line transition-colors duration-700 last:border-b-0", flash === entry.id && "bg-brand-soft")}>
                      <button
                        type="button"
                        aria-expanded={open}
                        className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-sand/60 lg:grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1.6fr)_7.5rem_7rem]"
                        onClick={() => setExpanded(open ? null : entry.id)}
                      >
                        <span
                          className={cn(
                            "grid size-8 place-items-center rounded-md",
                            isReturn ? "bg-pine/10 text-pine" : entry.movement === "purchase" ? "bg-brand-soft text-brand" : "bg-rust/10 text-rust",
                          )}
                          aria-label={WORD[entry.movement] ?? movementLabel(entry.movement)}
                        >
                          <Glyph className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{entry.companyName}</span>
                          <span className="block truncate text-xs text-muted lg:hidden">
                            {WORD[entry.movement] ?? movementLabel(entry.movement)} {entry.quantity}
                            {entry.cylinderType ? ` × ${entry.cylinderType}` : ""}
                            {serials.length ? <span className="code"> · {serials.slice(0, 2).join(", ")}{serials.length > 2 ? ` +${serials.length - 2}` : ""}</span> : null}
                          </span>
                        </span>
                        <span className="hidden min-w-0 text-sm lg:block">
                          <span className="block truncate">
                            {WORD[entry.movement] ?? movementLabel(entry.movement)} {entry.quantity}
                            {entry.cylinderType ? ` × ${entry.cylinderType}` : ""}
                          </span>
                          {serials.length ? <span className="code block truncate text-xs text-muted">{serials.slice(0, 4).join(", ")}{serials.length > 4 ? ` +${serials.length - 4}` : ""}</span> : null}
                        </span>
                        <span className="text-right lg:contents">
                          <span className="block text-sm font-semibold tabular-nums lg:text-right">{isReturn ? `+${entry.quantity}` : entry.amountDue != null ? rupee(entry.amountDue, 0) : "—"}</span>
                          <span
                            className={cn(
                              "block text-xs lg:text-right lg:text-sm",
                              isReturn || entry.paymentStatus === "received" ? "text-pine" : entry.paymentStatus === "partial" ? "text-ink" : "text-rust",
                            )}
                          >
                            {status}
                          </span>
                        </span>
                      </button>
                      {open ? (
                        <div className="grid gap-2 border-t border-dashed border-line bg-paper/60 px-4 py-3 pl-[3.75rem] text-sm">
                          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
                            {serials.length ? (
                              <>
                                <dt className="text-muted">Serials</dt>
                                <dd className="code break-words">{serials.join(", ")}</dd>
                              </>
                            ) : null}
                            {isReturn ? (
                              <>
                                <dt className="text-muted">From</dt>
                                <dd>{parent ? `Delivery of ${formatDay(parent.entryDate)}${parent.billNo ? ` · ${parent.billNo}` : ""}` : "Taken back"}</dd>
                              </>
                            ) : (
                              <>
                                {entry.unitPrice != null ? (
                                  <>
                                    <dt className="text-muted">Price</dt>
                                    <dd className="tabular-nums">{rupee(entry.unitPrice)} each</dd>
                                  </>
                                ) : null}
                                <dt className="text-muted">Due / received</dt>
                                <dd className="tabular-nums">
                                  {rupee(entry.amountDue)} / {rupee(entry.amountPaid)}
                                </dd>
                                {entry.billNo ? (
                                  <>
                                    <dt className="text-muted">Bill</dt>
                                    <dd className="code">{entry.billNo}</dd>
                                  </>
                                ) : null}
                              </>
                            )}
                            <dt className="text-muted">Entered by</dt>
                            <dd>{entry.createdBy === userId ? "You" : (memberName.get(entry.createdBy) ?? "A teammate")}</dd>
                            {entry.note && entry.note !== "Marked received" ? (
                              <>
                                <dt className="text-muted">Note</dt>
                                <dd>{entry.note}</dd>
                              </>
                            ) : null}
                          </dl>
                          {canEdit ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {isReturn ? null : (
                                <button type="button" className="btn btn-ghost h-9 min-h-0 px-3 text-sm" onClick={() => openEntrySheet({ entry })}>
                                  Edit
                                </button>
                              )}
                              {!isOwner ? null : pendingDelete === entry.id ? (
                                <>
                                  <button type="button" className="btn btn-danger h-9 min-h-0 px-3 text-sm" onClick={() => remove.mutate(entry)} disabled={remove.isPending}>
                                    {isReturn ? "Undo this return" : "Delete"}
                                  </button>
                                  <button type="button" className="btn btn-ghost h-9 min-h-0 px-3 text-sm" onClick={() => setPendingDelete(null)}>
                                    Keep
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-ghost h-9 min-h-0 gap-1.5 px-3 text-sm text-muted"
                                  aria-label={isReturn ? `Undo return from ${entry.companyName}` : `Delete ${entry.companyName}`}
                                  onClick={() => setPendingDelete(entry.id)}
                                >
                                  <Trash2 className="size-4" aria-hidden /> {isReturn ? "Undo return" : "Delete"}
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {shown.length > limit ? (
            <button type="button" className="w-full border-t border-line px-4 py-3 text-sm font-medium text-brand hover:bg-sand" onClick={() => setLimit((value) => value + 100)}>
              Show {Math.min(100, shown.length - limit)} older lines
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
