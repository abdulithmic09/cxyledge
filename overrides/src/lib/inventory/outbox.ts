import { useEffect, useState } from "react";
import { createEntry, createPayment, recordReturn, type EntryDraft, type PaymentDraft, type ReturnDraft } from "@/lib/inventory/api";

/** Something saved on this phone while there was no internet, waiting to be sent. */
export type OutboxItem =
  | { id: string; at: number; kind: "entry"; label: string; data: EntryDraft }
  | { id: string; at: number; kind: "payment"; label: string; data: PaymentDraft }
  | { id: string; at: number; kind: "return"; label: string; data: ReturnDraft };

type NewItem = { kind: "entry"; label: string; data: EntryDraft } | { kind: "payment"; label: string; data: PaymentDraft } | { kind: "return"; label: string; data: ReturnDraft };

const EVENT = "cx:outbox";
const keyFor = (yardId: string) => `cxyledge.outbox.${yardId}`;

export function readOutbox(yardId: string): OutboxItem[] {
  try {
    const raw = localStorage.getItem(keyFor(yardId));
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeOutbox(yardId: string, list: OutboxItem[]) {
  try {
    if (list.length) localStorage.setItem(keyFor(yardId), JSON.stringify(list));
    else localStorage.removeItem(keyFor(yardId));
  } catch {
    // storage blocked: nothing we can keep
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** True when the phone says it has no connection, so a save should wait in the outbox. */
export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function addToOutbox(yardId: string, item: NewItem): boolean {
  const list = readOutbox(yardId);
  if (list.length >= 200) return false;
  const full = { ...item, id: crypto.randomUUID(), at: Date.now() } as OutboxItem;
  writeOutbox(yardId, [...list, full]);
  return true;
}

export function dropFromOutbox(yardId: string, id: string) {
  writeOutbox(
    yardId,
    readOutbox(yardId).filter((item) => item.id !== id),
  );
}

/** The waiting items, kept up to date as they are added or sent. */
export function useOutbox(yardId: string | undefined) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (!yardId) return;
    const load = () => setItems(readOutbox(yardId));
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [yardId]);
  return items;
}

let sending = false;

/**
 * Send waiting items in the order they were saved. Stops at the first network failure (still offline)
 * and keeps anything the server refuses, with its reason, so nothing is lost silently.
 */
export async function flushOutbox(yardId: string): Promise<{ sent: number; failed: Array<{ label: string; error: string }> }> {
  const result = { sent: 0, failed: [] as Array<{ label: string; error: string }> };
  if (sending || isOffline()) return result;
  sending = true;
  try {
    for (const item of readOutbox(yardId)) {
      let outcome: { ok: boolean; error?: string };
      try {
        outcome =
          item.kind === "entry"
            ? await createEntry({ data: item.data })
            : item.kind === "payment"
              ? await createPayment({ data: item.data })
              : await recordReturn({ data: item.data });
      } catch {
        break; // still no connection; try again later
      }
      if (outcome.ok) {
        result.sent += 1;
        dropFromOutbox(yardId, item.id);
      } else {
        result.failed.push({ label: item.label, error: outcome.error ?? "Refused" });
        dropFromOutbox(yardId, item.id);
      }
    }
  } finally {
    sending = false;
  }
  return result;
}
