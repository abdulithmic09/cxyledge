import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listDeleted, listMembers, purgeDeleted, restoreDeleted, type BinItem } from "@/lib/inventory/api";
import { Panel } from "@/components/yard/ui";

function daysLeft(deletedAt: string) {
  const age = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, 30 - Math.floor(age / 86_400_000));
}

/** Owner-only: anything deleted in the last 30 days, with Restore. */
export function BinPanel({ onChanged }: { onChanged: () => void }) {
  const bin = useQuery({ queryKey: ["bin"], queryFn: () => listDeleted(), refetchInterval: 30000 });
  const members = useQuery({ queryKey: ["members"], queryFn: () => listMembers() });
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m.isYou ? "you" : m.name])), [members.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const items = bin.data ?? [];

  async function act(item: BinItem, action: "restore" | "purge") {
    setBusy(item.id);
    setNote("");
    const result = action === "restore" ? await restoreDeleted({ data: { kind: item.kind, id: item.id } }) : await purgeDeleted({ data: { kind: item.kind, id: item.id } });
    setBusy(null);
    setConfirm(null);
    setNote(result.ok ? (action === "restore" ? `Restored: ${item.title}` : "Deleted forever.") : result.error);
    await bin.refetch();
    onChanged();
  }

  return (
    <Panel title="Recently deleted">
      <p className="text-sm text-muted">Deleted entries, payments and files stay here for 30 days. Restore puts them back exactly as they were.</p>
      {bin.isPending ? <p className="mt-3 text-sm text-muted">Loading…</p> : null}
      {!bin.isPending && items.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing deleted in the last 30 days.</p> : null}
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted">{item.detail}</p>
              <p className="text-xs text-muted">
                Deleted {new Date(item.deletedAt).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                {item.deletedBy ? ` by ${names.get(item.deletedBy) ?? "a former member"}` : ""} · {daysLeft(item.deletedAt)} days left
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-pine" disabled={busy === item.id} onClick={() => void act(item, "restore")}>
                Restore
              </button>
              {confirm === item.id ? (
                <>
                  <button type="button" className="btn btn-rust" disabled={busy === item.id} onClick={() => void act(item, "purge")}>
                    Delete forever
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setConfirm(item.id)}>
                  Delete forever
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-2 text-sm text-pine" role="status">{note}</p> : null}
    </Panel>
  );
}
