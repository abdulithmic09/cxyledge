import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
import { Stat } from "@/components/yard/ui";
import { useRole } from "@/lib/inventory/role";
import { onShowEntry, openEntrySheet, takePendingShow } from "@/components/yard/entry-launcher";

const PAYMENTS: Array<{ id: PaymentStatus; label: string }> = [
  { id: "received", label: "Received" },
  { id: "partial", label: "Part received" },
  { id: "unpaid", label: "Not received" },
];

export function BookView({
  entries,
  payments,
  userId,
  onChanged,
  syncedAt,
}: {
  entries: Entry[];
  payments: Payment[];
  cylinderTypes?: string[];
  userId: string;
  logs?: ReturnLog[];
  onChanged: () => void;
  syncedAt: number;
}) {
  const { canEdit, isOwner } = useRole();
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentStatus | "all">("all");
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
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter !== "all" && entry.paymentStatus !== filter) return false;
      if (!needle) return true;
      return [entry.companyName, entry.serialNo, entry.note, entry.billNo, entry.movement, paymentLabel(entry.paymentStatus)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, filter, query]);
  // Long books render in pages so the phone stays quick.
  const [limit, setLimit] = useState(60);

  const synced = syncedAt ? new Date(syncedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

  // "View in book" after saving: scroll to the new line and highlight it for a moment.
  useEffect(() => {
    const show = (id: string) => {
      setQuery("");
      setFilter("all");
      setFlash(id);
      window.setTimeout(() => document.getElementById(`entry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
      window.setTimeout(() => setFlash(null), 2600);
    };
    const pending = takePendingShow();
    if (pending) show(pending);
    return onShowEntry(show);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Cylinder book</h2>
          <p className="mt-1 text-sm text-muted">
            {entries.length} {entries.length === 1 ? "line" : "lines"}
            {synced ? ` · synced ${synced}` : ""}. A new line on any signed-in phone or computer shows up here.
          </p>
        </div>
      </div>

      {undo ? (
        <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm" role="status">
          Entry deleted ({undo.label}). It&apos;s in Settings → Recently deleted for 30 days.{" "}
          <button type="button" className="font-semibold text-pine underline" disabled={restore.isPending} onClick={() => restore.mutate(undo.id)}>
            Undo
          </button>{" "}
          <button type="button" className="text-muted underline" onClick={() => setUndo(null)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-line bg-sand px-4 py-3 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Still with customers" value={stillOut} tone="rust" />
        <Stat label="To collect" value={rupee(toCollect, 0)} tone="pine" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className="field sm:max-w-xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search company, serial, or bill"
          aria-label="Search entries"
        />
        <div className="flex flex-wrap gap-2">
          {(["all", "unpaid", "partial", "received"] as const).map((id) => (
            <button key={id} type="button" className={cn("btn px-3 text-sm", filter === id ? "btn-pine" : "btn-ghost")} onClick={() => setFilter(id)}>
              {id === "all" ? "All" : PAYMENTS.find((payment) => payment.id === id)?.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card px-4 py-8 text-center">
          <p className="text-sm text-muted">
            {entries.length === 0
              ? "No cylinders booked yet. Tap New entry to give cylinders, take empties back, or record stock you bought."
              : "Nothing matches that filter."}
          </p>
          {entries.length === 0 && canEdit ? (
            <button type="button" className="btn btn-rust mt-4 gap-2" onClick={() => openEntrySheet()}>
              <Plus className="size-4" aria-hidden /> New entry
            </button>
          ) : null}
          {entries.length === 0 && isOwner ? (
            <button type="button" className="btn btn-ghost mt-4" disabled={sample.isPending} onClick={() => sample.mutate()}>
              {sample.isPending ? "Adding…" : "Add a sample week"}
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.slice(0, limit).map((entry) => (
            <li key={entry.id} id={`entry-${entry.id}`} className={cn("rounded-xl border p-4 transition-colors duration-700", flash === entry.id ? "border-pine bg-pine/10 ring-2 ring-pine/40" : "border-line bg-card")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-xl leading-tight">{entry.companyName}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {formatDay(entry.entryDate)} · {movementLabel(entry.movement)} · {entry.quantity}{" "}
                    {entry.quantity === 1 ? "cylinder" : "cylinders"}
                    {entry.cylinderType ? ` · ${entry.cylinderType}` : ""}
                    {entry.createdBy === userId ? " · by you" : ` · by ${memberName.get(entry.createdBy) ?? "a teammate"}`}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", entry.paymentStatus === "received" ? "bg-pine text-pine-fg" : "bg-sand text-rust")}>
                  {paymentLabel(entry.paymentStatus)}
                </span>
              </div>
              {entry.serialNo ? <p className="mt-3 whitespace-pre-wrap text-sm">Serial {entry.serialNo}</p> : null}
              <p className="mt-2 text-sm tabular-nums text-muted">
                {entry.unitPrice != null ? `Price ${rupee(entry.unitPrice)} · ` : ""}
                Due {rupee(entry.amountDue)} · Received {rupee(entry.amountPaid)}
                {entry.billNo ? ` · ${entry.billNo}` : ""}
              </p>
              {entry.note ? <p className="mt-2 text-sm">{entry.note}</p> : null}
              {canEdit ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => openEntrySheet({ entry })}>
                  Edit
                </button>
                {!isOwner ? null : pendingDelete === entry.id ? (
                  <>
                    <button type="button" className="btn btn-rust" onClick={() => remove.mutate(entry)} disabled={remove.isPending}>
                      Delete
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setPendingDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost size-11 px-0" aria-label={`Delete ${entry.companyName}`} onClick={() => setPendingDelete(entry.id)}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </div>
              ) : null}
            </li>
          ))}
          {shown.length > limit ? (
            <li>
              <button type="button" className="btn btn-ghost w-full" onClick={() => setLimit((value) => value + 100)}>
                Show more ({shown.length - limit} older lines)
              </button>
            </li>
          ) : null}
        </ul>
      )}

    </div>
  );
}
