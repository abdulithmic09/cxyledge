import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  exportBackup,
  exportDocumentContents,
  getYard,
  restoreChunk,
  startRestore,
  type BackupDocument,
  type BackupFile,
  type YardInfo,
} from "@/lib/inventory/api";
import { csvBlob, downloadBlob, toCsv } from "@/lib/inventory/files";
import { getTracking, restoreTracking } from "@/lib/inventory/tracking";
import { movementLabel, paymentLabel } from "@/lib/inventory/analyse";
import { useRole } from "@/lib/inventory/role";
import { Panel } from "@/components/yard/ui";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_BYTES = 2_500_000;

function stamp(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the reminder simply shows again
  }
}

const autoKey = (yardId: string) => `cxyledge.autobackup.${yardId}`;
const snoozeKey = (yardId: string) => `cxyledge.backupsnooze.${yardId}`;

/** Fetch everything, including file contents in batches, and save one backup file on this device. */
async function downloadBackup(onStep?: (text: string) => void): Promise<{ ok: true; backup: BackupFile } | { ok: false; error: string }> {
  onStep?.("Collecting the book…");
  const result = await exportBackup();
  if (!result.ok) return result;
  const backup = result.backup;
  const docs = backup.documents;
  const batches: BackupDocument[][] = [];
  let current: BackupDocument[] = [];
  let size = 0;
  for (const doc of docs) {
    const bytes = doc.size ?? 0;
    if (current.length && (size + bytes > BATCH_BYTES || current.length >= 40)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(doc);
    size += bytes;
  }
  if (current.length) batches.push(current);
  const contents = new Map<string, string>();
  for (const [index, batch] of batches.entries()) {
    onStep?.(`Collecting files ${index + 1} of ${batches.length}…`);
    const part = await exportDocumentContents({ data: batch.map((doc) => doc.id) });
    if (!part.ok) return part;
    for (const row of part.contents) contents.set(row.id, row.content);
  }
  backup.documents = docs.map(({ size: _size, ...doc }) => ({ ...doc, content: contents.get(doc.id) ?? "" }));
  onStep?.("Collecting stock, deposits and challans…");
  try {
    backup.tracking = await getTracking();
    const yard = await getYard();
    backup.cylinderTypes = yard.cylinderTypes;
  } catch {
    return { ok: false, error: "Couldn't collect stock, deposits and challans. Check your internet connection and try again." };
  }
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  downloadBlob(`cxyledge-backup-${slug(backup.book.name)}-${stamp()}.json`, blob);
  return { ok: true, backup };
}

/** True when the owner hasn't backed up this book for a week. */
export function backupDue(yard: YardInfo) {
  return !yard.lastBackupAt || Date.now() - new Date(yard.lastBackupAt).getTime() > WEEK_MS;
}

/** Owner-only note: shows when the last backup is more than a week old, or downloads it by itself if that's switched on. */
export function BackupReminder({ yard, hasData, onDone }: { yard: YardInfo; hasData: boolean; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [text, setText] = useState("");
  const [hidden, setHidden] = useState(true);
  const ran = useRef(false);
  const due = backupDue(yard);

  async function run(auto: boolean) {
    setState("working");
    const result = await downloadBackup(setText);
    if (!result.ok) {
      setState("error");
      setText(result.error);
      return;
    }
    setState("done");
    setText(auto ? "This week's backup was downloaded to this device automatically." : "Backup downloaded to this device.");
    onDone();
  }

  useEffect(() => {
    if (!due || !hasData) {
      setHidden(true);
      return;
    }
    const snoozed = Number(read(snoozeKey(yard.id)) ?? 0);
    if (snoozed > Date.now()) {
      setHidden(true);
      return;
    }
    setHidden(false);
    if (read(autoKey(yard.id)) === "1" && !ran.current) {
      ran.current = true;
      void run(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, hasData, yard.id]);

  if (hidden && state === "idle") return null;
  if (state === "done") {
    return (
      <p className="mb-3 card px-3.5 py-2 text-sm text-pine" role="status">
        {text}{" "}
        <button type="button" className="font-semibold text-brand" onClick={() => { setState("idle"); setHidden(true); }}>
          Dismiss
        </button>
      </p>
    );
  }
  const days = yard.lastBackupAt ? Math.floor((Date.now() - new Date(yard.lastBackupAt).getTime()) / 86_400_000) : null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 card px-3.5 py-2 text-sm" role="status">
      <ShieldAlert className="size-4 shrink-0 text-muted" aria-hidden />
      <p className="min-w-0 flex-1">
        {days == null ? "No backup yet." : `Last backup ${days} days ago (${day(yard.lastBackupAt!)}).`}
        {state === "error" ? <span className="block text-rust">{text}</span> : null}
      </p>
      <button type="button" className="font-semibold text-brand" disabled={state === "working"} onClick={() => void run(false)}>
        {state === "working" ? text || "Working…" : "Back up now"}
      </button>
      <button
        type="button"
        className="text-muted"
        disabled={state === "working"}
        onClick={() => {
          write(snoozeKey(yard.id), String(Date.now() + 7 * 24 * 60 * 60 * 1000));
          setHidden(true);
          setState("idle");
        }}
      >
        Next week
      </button>
    </div>
  );
}

function freshId() {
  return crypto.randomUUID();
}

function isBackup(value: unknown): value is BackupFile {
  const v = value as BackupFile;
  return Boolean(v && v.format === "cxyledge-backup" && Array.isArray(v.entries) && v.book);
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

/** Settings panel: one-click backup, spreadsheets, weekly automatic copy, and restore into a new account. */
export function BackupPanel({ yard, entriesCsv, paymentsCsv, onChanged }: { yard: YardInfo; entriesCsv: () => string; paymentsCsv: () => string; onChanged: () => void }) {
  const { isOwner } = useRole();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);

  useEffect(() => {
    setAuto(read(autoKey(yard.id)) === "1");
  }, [yard.id]);

  async function backupNow() {
    setBusy(true);
    setError("");
    const result = await downloadBackup(setNote);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setNote("");
      return;
    }
    const b = result.backup;
    setNote(`Backup downloaded: ${b.entries.length} entries, ${b.payments.length} payments, ${b.documents.length} files.`);
    onChanged();
  }

  async function restore(backup: BackupFile) {
    setBusy(true);
    setError("");
    try {
      const name = `${backup.book.name || "Book"} (restored ${day(new Date().toISOString())})`.slice(0, 60);
      const started = await startRestore({ data: { name, book: backup.book } });
      if (!started.ok) throw new Error("Could not start the restore.");
      const yardId = started.yardId;
      const entryIds = new Map(backup.entries.map((entry) => [entry.id, freshId()]));
      const tracking = backup.tracking;
      const moveIds = new Map((tracking?.moves ?? []).map((move) => [move.id, freshId()]));
      // Refill charges point at their plant trip as "plant:<trip id>"; keep that link with the trip's new id.
      const parentOf = (parentId: string | null) => {
        if (!parentId) return null;
        if (parentId.startsWith("plant:")) {
          const trip = moveIds.get(parentId.slice(6));
          return trip ? `plant:${trip}` : null;
        }
        return entryIds.get(parentId) ?? null;
      };
      const entries = backup.entries.map((entry) => ({
        ...entry,
        id: entryIds.get(entry.id)!,
        parentId: parentOf(entry.parentId),
      }));
      const returnLogs = (backup.returnLogs ?? []).map((row) => ({ ...row, id: freshId(), entryId: row.entryId ? (entryIds.get(row.entryId) ?? null) : null }));
      const payments = (backup.payments ?? []).map((row) => ({ ...row, id: freshId() }));
      const docs = (backup.documents ?? []).filter((doc) => doc.content).map((doc) => ({ ...doc, id: freshId() }));
      // Deliveries first so returns can point at them.
      const ordered = [...entries.filter((entry) => entry.movement !== "return"), ...entries.filter((entry) => entry.movement === "return")];
      const steps: Array<{ label: string; send: () => Promise<unknown> }> = [];
      chunk(ordered, 250).forEach((rows, index, all) => steps.push({ label: `entries ${index + 1}/${all.length}`, send: () => restoreChunk({ data: { yardId, entries: rows } }) }));
      chunk(returnLogs, 300).forEach((rows) => steps.push({ label: "returns", send: () => restoreChunk({ data: { yardId, returnLogs: rows } }) }));
      chunk(payments, 300).forEach((rows) => steps.push({ label: "payments", send: () => restoreChunk({ data: { yardId, payments: rows } }) }));
      chunk(backup.companyMeta ?? [], 300).forEach((rows) => steps.push({ label: "company notes", send: () => restoreChunk({ data: { yardId, companyMeta: rows } }) }));
      if (tracking) {
        steps.push({
          label: "terms and gas types",
          send: () =>
            restoreTracking({
              data: { yardId, settings: { terms: tracking.terms, creditDays: tracking.creditDays, cylinderTypes: backup.cylinderTypes, companyTerms: tracking.companyTerms, companyCredit: tracking.companyCredit } },
            }),
        });
        const moves = tracking.moves.map((move) => ({ ...move, id: moveIds.get(move.id)! }));
        chunk(moves, 300).forEach((rows) => steps.push({ label: "plant trips and counts", send: () => restoreTracking({ data: { yardId, moves: rows } }) }));
        chunk(tracking.deposits.map((row) => ({ ...row, id: freshId() })), 300).forEach((rows) => steps.push({ label: "deposits", send: () => restoreTracking({ data: { yardId, deposits: rows } }) }));
        chunk(tracking.challans.map((row) => ({ ...row, id: freshId() })), 50).forEach((rows) => steps.push({ label: "challans", send: () => restoreTracking({ data: { yardId, challans: rows } }) }));
        chunk(tracking.billMeta ?? [], 500).forEach((rows) => steps.push({ label: "monthly bills", send: () => restoreTracking({ data: { yardId, billMeta: rows } }) }));
      }
      let batch: BackupDocument[] = [];
      let size = 0;
      const docBatches: BackupDocument[][] = [];
      for (const doc of docs) {
        const bytes = doc.content?.length ?? 0;
        if (batch.length && (size + bytes > BATCH_BYTES || batch.length >= 40)) {
          docBatches.push(batch);
          batch = [];
          size = 0;
        }
        batch.push(doc);
        size += bytes;
      }
      if (batch.length) docBatches.push(batch);
      docBatches.forEach((rows, index, all) => steps.push({ label: `files ${index + 1}/${all.length}`, send: () => restoreChunk({ data: { yardId, documents: rows } }) }));
      for (const [index, step] of steps.entries()) {
        setNote(`Restoring ${step.label} (${index + 1} of ${steps.length})…`);
        const result = (await step.send()) as { ok: boolean; error?: string };
        if (!result.ok) throw new Error(result.error ?? "Restore stopped part-way.");
      }
      setPending(null);
      setNote(`Restored into a new account, "${name}". You're in it now. Switch accounts below to go back.`);
      await queryClient.invalidateQueries();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  const last = yard.lastBackupAt ? `Last backup ${day(yard.lastBackupAt)}.` : "No backup yet.";

  return (
    <Panel title="Backup">
      {isOwner ? (
        <>
          <p className="text-sm text-muted">
            One file with every entry, payment, bill, file, company note and the activity log. Keep it somewhere safe, like Google Drive or email it to yourself. {last}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void backupNow()}>
              {busy && !pending ? "Working…" : "Download full backup"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => downloadBlob(`cxyledge-entries-${stamp()}.csv`, csvBlob(entriesCsv()))}>
              Entries spreadsheet
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => downloadBlob(`cxyledge-payments-${stamp()}.csv`, csvBlob(paymentsCsv()))}>
              Payments spreadsheet
            </button>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={auto}
            className="btn btn-ghost mt-3 h-auto min-h-11 w-full justify-between gap-3 whitespace-normal py-2.5 text-left sm:w-auto sm:gap-4"
            onClick={() => {
              const next = !auto;
              setAuto(next);
              write(autoKey(yard.id), next ? "1" : null);
            }}
          >
            Download a backup automatically every week on this device
            <span className={auto ? "inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-pine p-1" : "inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-line p-1"}>
              <span className={auto ? "ml-auto size-5 rounded-full bg-card" : "size-5 rounded-full bg-card"} />
            </span>
          </button>
          <p className="mt-1 text-xs text-muted">
            When a week has passed, opening Cxyledge on this device saves a new backup file by itself. Without this, you get a reminder instead.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Only the owner can download a full backup of this book.</p>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="font-semibold">Restore a backup</h3>
        <p className="mt-1 text-sm text-muted">Loads a backup file into a new account. Your current books are not changed.</p>
        <input
          className="field mt-2 py-2"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          aria-label="Choose a backup file"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            setError("");
            setNote("");
            if (!file) return;
            try {
              const parsed: unknown = JSON.parse(await file.text());
              if (!isBackup(parsed)) {
                setError("That isn't a Cxyledge backup file.");
                return;
              }
              setPending(parsed);
            } catch {
              setError("Couldn't read that file.");
            }
          }}
        />
        {pending ? (
          <div className="mt-3 rounded-lg border border-line bg-sand px-3 py-3 text-sm">
            <p>
              Backup of <span className="font-semibold">{pending.book.name}</span> from {day(pending.exportedAt)}: {pending.entries.length} entries, {pending.payments?.length ?? 0} payments, {pending.documents?.length ?? 0} files.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void restore(pending)}>
                {busy ? "Restoring…" : "Restore into a new account"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-rust" role="alert">{error}</p> : null}
      {note ? <p className="mt-3 text-sm text-pine" role="status">{note}</p> : null}
    </Panel>
  );
}

export function entriesCsvText(entries: import("@/lib/inventory/api").Entry[]) {
  return toCsv(
    ["Date", "Company", "Movement", "Gas type", "Qty", "Serials", "Price", "Amount", "Received with bill", "Payment", "Bill no.", "Note"],
    entries.map((entry) => [
      entry.entryDate.split("-").reverse().join("/"),
      entry.companyName,
      movementLabel(entry.movement),
      entry.cylinderType,
      String(entry.quantity),
      entry.serialNo.replace(/\n/g, " "),
      entry.unitPrice == null ? "" : String(entry.unitPrice),
      entry.amountDue == null ? "" : String(entry.amountDue),
      entry.amountPaid == null ? "" : String(entry.amountPaid),
      paymentLabel(entry.paymentStatus),
      entry.billNo,
      entry.note,
    ]),
  );
}

export function paymentsCsvText(payments: import("@/lib/inventory/api").Payment[]) {
  return toCsv(
    ["Date", "Receipt no.", "Company", "Type", "Amount", "Mode", "Reference", "Against bill", "Note"],
    payments.map((payment) => [
      payment.paidOn.split("-").reverse().join("/"),
      payment.receiptNo,
      payment.companyName,
      payment.direction === "in" ? "Received" : payment.direction === "charge" ? "Holding charge" : "Paid out",
      String(payment.amount),
      payment.mode.toUpperCase(),
      payment.reference,
      payment.billNo,
      payment.note,
    ]),
  );
}
