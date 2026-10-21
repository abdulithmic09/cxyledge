import { useMemo, useState } from "react";
import { createPayment, deletePayment, restoreDeleted, PAYMENT_MODES, type Entry, type Payment, type PaymentDirection, type PaymentMode, type YardInfo } from "@/lib/inventory/api";
import type { CompanyBalance } from "@/lib/inventory/analyse";
import { rupee } from "@/lib/inventory/serials";
import { rupeesInWords } from "@/lib/inventory/words";
import { toCsv } from "@/lib/inventory/files";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { ExportBar } from "@/components/yard/export-bar";
import { Field, Panel } from "@/components/yard/ui";

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dmy(iso: string) {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

const modeLabel = (mode: PaymentMode) => PAYMENT_MODES.find((item) => item.id === mode)?.label ?? mode;

export function receiptLines(yard: YardInfo, payment: Payment, balanceAfter: number | null): string[] {
  const received = payment.direction === "in";
  const letterhead = [yard.address.replace(/\n/g, ", "), [yard.phone && `Phone ${yard.phone}`, yard.gst && `GST ${yard.gst}`].filter(Boolean).join(" · ")].filter(Boolean);
  return [
    yard.name,
    ...letterhead,
    "",
    `${received ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER"}   No. ${payment.receiptNo}   Date ${dmy(payment.paidOn)}`,
    "",
    received ? `Received with thanks from ${payment.companyName}` : `Paid to ${payment.companyName}`,
    `the sum of ${rupee(payment.amount)}`,
    `(${rupeesInWords(payment.amount)})`,
    `by ${modeLabel(payment.mode)}${payment.reference ? `, ref. ${payment.reference}` : ""}`,
    payment.billNo ? `against bill ${payment.billNo}` : "",
    payment.note ? `Note: ${payment.note}` : "",
    "",
    balanceAfter != null && received ? `Balance still due after this payment: ${rupee(balanceAfter)}` : "",
    "",
    `For ${yard.name}`,
    "",
    "Authorised signatory",
  ].filter((line, index, all) => line !== "" || (all[index - 1] ?? "") !== "");
}

/** Record payments (including part-payments) against a company, and print receipts. */
export function PaymentsPanel({
  yard,
  company,
  entries,
  payments,
  balance,
  onChanged,
}: {
  yard: YardInfo;
  company: string;
  entries: Entry[];
  payments: Payment[];
  balance: CompanyBalance | undefined;
  onChanged: () => void;
}) {
  const { canEdit, isOwner } = useRole();
  const [direction, setDirection] = useState<PaymentDirection>("in");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO);
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [billNo, setBillNo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [undo, setUndo] = useState<Payment | null>(null);

  const mine = useMemo(() => payments.filter((payment) => payment.companyName === company), [payments, company]);
  const bills = useMemo(
    () => [...new Set(entries.filter((entry) => entry.companyName === company && entry.billNo).map((entry) => entry.billNo))].sort().reverse(),
    [entries, company],
  );
  const hasPurchases = entries.some((entry) => entry.companyName === company && entry.movement === "purchase");
  const due = direction === "in" ? (balance?.toCollect ?? 0) : (balance?.toPay ?? 0);
  const selected = mine.find((payment) => payment.id === receipt) ?? null;

  async function save() {
    setError("");
    setSaved("");
    const value = Number(amount.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter the amount.");
      return;
    }
    setBusy(true);
    try {
      const result = await createPayment({ data: { companyName: company, direction, amount: value, paidOn, mode, reference, billNo, note } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(`${result.payment.receiptNo} saved: ${rupee(value)} ${direction === "in" ? "received from" : "paid to"} ${company}.`);
      setReceipt(result.payment.id);
      setAmount("");
      setReference("");
      setBillNo("");
      setNote("");
      onChanged();
    } catch {
      setError("Could not save. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  }

  const csv = toCsv(
    ["Date", "Receipt no.", "Type", "Amount", "Mode", "Reference", "Against bill", "Note"],
    mine.map((payment) => [dmy(payment.paidOn), payment.receiptNo, payment.direction === "in" ? "Received" : "Paid out", String(payment.amount), modeLabel(payment.mode), payment.reference, payment.billNo, payment.note]),
  );

  return (
    <Panel title="Payments">
      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {hasPurchases ? (
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              {(["in", "out"] as const).map((item) => (
                <button key={item} type="button" className={cn("btn", direction === item ? "btn-pine" : "btn-ghost")} onClick={() => setDirection(item)}>
                  {item === "in" ? "Received from them" : "Paid to them"}
                </button>
              ))}
            </div>
          ) : null}
          <Field label="Amount (₹)" hint={due > 0 ? `${direction === "in" ? "Still to collect" : "Still to pay"} ${rupee(due, 0)}. Part-payments are fine.` : undefined}>
            <input className="field tabular-nums" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
          </Field>
          <Field label="Date">
            <input type="date" className="field" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
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
          <Field label={mode === "cheque" ? "Cheque no." : mode === "upi" || mode === "bank" ? "UTR / transaction ID" : "Reference"}>
            <input className="field" value={reference} maxLength={60} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Field label="Against bill (optional)">
            <input className="field" value={billNo} maxLength={40} list="payment-bills" onChange={(event) => setBillNo(event.target.value)} />
            <datalist id="payment-bills">
              {bills.map((bill) => (
                <option key={bill} value={bill} />
              ))}
            </datalist>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note">
              <input className="field" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          {error ? <p className="text-sm text-rust sm:col-span-2" role="alert">{error}</p> : null}
          {saved ? <p className="text-sm text-pine sm:col-span-2" role="status">{saved}</p> : null}
          <div className="sm:col-span-2">
            <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : direction === "in" ? "Record payment received" : "Record payment made"}
            </button>
          </div>
        </div>
      ) : null}

      {undo ? (
        <p className="mt-3 text-sm" role="status">
          Payment {undo.receiptNo} deleted. It&apos;s in Recently deleted for 30 days.{" "}
          <button
            type="button"
            className="font-semibold text-pine underline"
            onClick={() => {
              void restoreDeleted({ data: { kind: "payment", id: undo.id } }).then(() => {
                setUndo(null);
                onChanged();
              });
            }}
          >
            Undo
          </button>
        </p>
      ) : null}

      <div className={canEdit ? "mt-5 border-t border-line pt-4" : ""}>
        {mine.length === 0 ? (
          <p className="text-sm text-muted">No separate payments recorded for {company} yet. Money received with a bill is in the ledger below.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {mine.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium tabular-nums">
                    {payment.receiptNo} · {rupee(payment.amount)} {payment.direction === "in" ? "received" : "paid out"}
                  </p>
                  <p className="text-xs text-muted">
                    {dmy(payment.paidOn)} · {modeLabel(payment.mode)}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                    {payment.billNo ? ` · bill ${payment.billNo}` : ""}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={cn("btn", receipt === payment.id ? "btn-pine" : "btn-ghost")} onClick={() => setReceipt(receipt === payment.id ? null : payment.id)}>
                    {payment.direction === "in" ? "Receipt" : "Voucher"}
                  </button>
                  {isOwner ? (
                    confirm === payment.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-rust"
                          onClick={() => {
                            void deletePayment({ data: payment.id }).then((result) => {
                              setConfirm(null);
                              if (!result.ok) {
                                setError(result.error);
                                return;
                              }
                              if (receipt === payment.id) setReceipt(null);
                              setUndo(payment);
                              onChanged();
                            });
                          }}
                        >
                          Delete
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirm(payment.id)}>
                        Delete
                      </button>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {mine.length ? (
          <div className="mt-3">
            <ExportBar title={`${company} payments`} filename={`cxyledge-payments-${company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} lines={mine.map((payment) => `${dmy(payment.paidOn)}  ${payment.receiptNo}  ${rupee(payment.amount)}  ${modeLabel(payment.mode)} ${payment.reference}  ${payment.billNo}`)} csv={csv} />
          </div>
        ) : null}
      </div>

      {selected ? <ReceiptCard yard={yard} payment={selected} balanceAfter={selected.id === mine[0]?.id ? (balance?.toCollect ?? null) : null} /> : null}
    </Panel>
  );
}

function ReceiptCard({ yard, payment, balanceAfter }: { yard: YardInfo; payment: Payment; balanceAfter: number | null }) {
  const lines = receiptLines(yard, payment, balanceAfter);
  const received = payment.direction === "in";
  return (
    <div className="mt-5 border-t border-line pt-4">
      <article className="rounded-xl border border-line bg-paper p-4 text-sm">
        {yard.logo ? <img src={yard.logo} alt="" className="mb-3 h-12 w-auto" /> : null}
        <h3 className="font-display text-2xl">{yard.name}</h3>
        {yard.address ? <p className="mt-1 whitespace-pre-wrap text-muted">{yard.address}</p> : null}
        <p className="mt-1 text-muted">{[yard.phone && `Phone ${yard.phone}`, yard.gst && `GST ${yard.gst}`].filter(Boolean).join(" · ")}</p>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-y border-line py-2">
          <p className="font-semibold tracking-wide">{received ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER"}</p>
          <p className="tabular-nums text-muted">
            No. {payment.receiptNo} · {dmy(payment.paidOn)}
          </p>
        </div>
        <p className="mt-3">
          {received ? "Received with thanks from" : "Paid to"} <span className="font-semibold">{payment.companyName}</span> the sum of{" "}
          <span className="font-semibold tabular-nums">{rupee(payment.amount)}</span>
        </p>
        <p className="mt-1 italic text-muted">({rupeesInWords(payment.amount)})</p>
        <p className="mt-1">
          by {modeLabel(payment.mode)}
          {payment.reference ? `, ref. ${payment.reference}` : ""}
          {payment.billNo ? `, against bill ${payment.billNo}` : ""}.
        </p>
        {payment.note ? <p className="mt-1 text-muted">{payment.note}</p> : null}
        {balanceAfter != null && received ? <p className="mt-3 tabular-nums">Balance still due: {rupee(balanceAfter)}</p> : null}
        <p className="mt-6 text-right">
          For {yard.name}
          <span className="mt-8 block text-xs text-muted">Authorised signatory</span>
        </p>
      </article>
      <div className="mt-3">
        <ExportBar title={`${received ? "Receipt" : "Voucher"} ${payment.receiptNo}`} filename={`${payment.receiptNo}-${payment.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} lines={lines} csv={toCsv(["Receipt", "Date", "Company", "Amount", "Mode", "Reference", "Bill"], [[payment.receiptNo, dmy(payment.paidOn), payment.companyName, String(payment.amount), modeLabel(payment.mode), payment.reference, payment.billNo]])} />
      </div>
    </div>
  );
}
