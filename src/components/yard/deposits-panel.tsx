import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { PAYMENT_MODES, type YardInfo } from "@/lib/inventory/api";
import { deleteDeposit, getTracking, saveDeposit, type Deposit } from "@/lib/inventory/tracking";
import { depositBalance } from "@/lib/inventory/stock";
import { dmy, makeReceiptPdf, pdfName } from "@/lib/inventory/bill-pdf";
import { downloadBlob } from "@/lib/inventory/files";
import { rupee, splitSerials } from "@/lib/inventory/serials";
import { todayISO } from "@/lib/inventory/model";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { Field, Panel } from "@/components/yard/ui";

const modeLabel = (mode: string) => PAYMENT_MODES.find((item) => item.id === mode)?.label ?? mode;

/** Security deposits a company has paid for cylinders, and refunds. Kept apart from their bill balance. */
export function DepositsPanel({ yard, company }: { yard: YardInfo; company: string }) {
  const { canEdit, isOwner } = useRole();
  const client = useQueryClient();
  const tracking = useQuery({ queryKey: ["tracking"], queryFn: () => getTracking() });
  const mine = useMemo(() => (tracking.data?.deposits ?? []).filter((deposit) => deposit.companyName === company), [tracking.data, company]);
  const balance = depositBalance(mine, company);
  const [direction, setDirection] = useState<Deposit["direction"]>("taken");
  const [amount, setAmount] = useState("");
  const [cylinders, setCylinders] = useState("");
  const [serials, setSerials] = useState("");
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const counted = splitSerials(serials).length;

  function receipt(deposit: Deposit) {
    void makeReceiptPdf({
      yard,
      direction: deposit.direction === "taken" ? "in" : "out",
      receiptNo: deposit.receiptNo,
      date: deposit.date,
      company: deposit.companyName,
      amount: deposit.amount,
      mode: modeLabel(deposit.mode),
      reference: deposit.reference,
      billNo: "",
      note: [deposit.cylinders ? `${deposit.cylinders} cylinder${deposit.cylinders === 1 ? "" : "s"}${deposit.gasType ? ` · ${deposit.gasType}` : ""}` : "", deposit.serials.length ? `Serial nos.: ${deposit.serials.join(", ")}` : "", deposit.note].filter(Boolean).join(" · "),
      balanceAfter: null,
      title: deposit.direction === "taken" ? "DEPOSIT RECEIPT" : "DEPOSIT REFUND",
    }).then((pdf) => downloadBlob(pdfName(deposit.receiptNo, deposit.companyName), pdf));
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveDeposit({ data: { companyName: company, direction, amount: Number(amount) || 0, cylinders: Number(cylinders) || 0, gasType: "", serialNo: serials, date, mode, reference, note } });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      setStatus({ tone: "ok", text: `${result.receiptNo} saved. Tap the receipt below to download it.` });
      setAmount("");
      setCylinders("");
      setSerials("");
      setReference("");
      setNote("");
      await client.invalidateQueries({ queryKey: ["tracking"] });
    } catch {
      setStatus({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Security deposit">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">Money held against cylinders. It is not part of what {company} owes on bills.</p>
        <p className="text-right">
          <span className="block font-display text-2xl tabular-nums">{rupee(balance.held)}</span>
          <span className="text-xs text-muted">held{balance.cylinders ? ` for ${balance.cylinders} cylinders` : ""}</span>
        </p>
      </div>
      {canEdit ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            {(["taken", "refunded"] as const).map((item) => (
              <button key={item} type="button" className={cn("btn text-sm", direction === item ? "btn-pine" : "btn-ghost")} onClick={() => setDirection(item)}>
                {item === "taken" ? "Deposit taken" : "Deposit refunded"}
              </button>
            ))}
          </div>
          <Field label="Amount (₹)">
            <input className="field tabular-nums" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <Field label="Date">
            <input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Cylinder serials (optional)" hint={counted ? `${counted} counted` : undefined}>
            <textarea className="field field-area min-h-16" value={serials} onChange={(event) => setSerials(event.target.value)} />
          </Field>
          <Field label="Or number of cylinders">
            <input className={cn("field tabular-nums", counted && "bg-sand")} readOnly={Boolean(counted)} inputMode="numeric" value={counted ? String(counted) : cylinders} onChange={(event) => setCylinders(event.target.value.replace(/[^\d]/g, ""))} />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Paid by</legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_MODES.map((item) => (
                <button key={item.id} type="button" className={cn("btn px-3 text-sm", mode === item.id ? "btn-pine" : "btn-ghost")} onClick={() => setMode(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Reference">
            <input className="field" value={reference} maxLength={60} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Field label="Note">
            <input className="field" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {status ? <p className={cn("text-sm sm:col-span-2", status.tone === "ok" ? "text-pine" : "text-rust")} role="status">{status.text}</p> : null}
          <div className="sm:col-span-2">
            <button type="button" className="btn btn-rust" disabled={busy || !amount} onClick={() => void save()}>
              {busy ? "Saving…" : direction === "taken" ? "Record deposit taken" : "Record refund"}
            </button>
          </div>
        </div>
      ) : null}
      {mine.length ? (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {mine.map((deposit) => (
            <li key={deposit.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium tabular-nums">
                  {deposit.receiptNo} · {deposit.direction === "taken" ? "Taken" : "Refunded"} {rupee(deposit.amount)}
                </p>
                <p className="text-xs text-muted">
                  {dmy(deposit.date)} · {modeLabel(deposit.mode)}
                  {deposit.cylinders ? ` · ${deposit.cylinders} cylinders` : ""}
                  {deposit.note ? ` · ${deposit.note}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => receipt(deposit)}>
                  Receipt
                </button>
                {isOwner ? (
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-rust"
                    aria-label={`Remove ${deposit.receiptNo}`}
                    onClick={() => void deleteDeposit({ data: deposit.id }).then(() => client.invalidateQueries({ queryKey: ["tracking"] }))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
