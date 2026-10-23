import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Copy, MessageCircle } from "lucide-react";
import { listCompanyMeta, type Entry, type Payment } from "@/lib/inventory/api";
import { getTracking, saveCreditDays } from "@/lib/inventory/tracking";
import { dueRows, reminderMessage } from "@/lib/inventory/dues";
import { waNumber, whatsappLink } from "@/lib/inventory/whatsapp";
import { dmy } from "@/lib/inventory/bill-pdf";
import { rupee } from "@/lib/inventory/serials";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { Field, Panel } from "@/components/yard/ui";

/** Bills past their credit days, with a one-tap WhatsApp reminder. */
export function OverduePanel({ entries, payments, yardName }: { entries: Entry[]; payments: Payment[]; yardName: string }) {
  const { isOwner } = useRole();
  const client = useQueryClient();
  const tracking = useQuery({ queryKey: ["tracking"], queryFn: () => getTracking() });
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });
  const phones = useMemo(() => new Map((metaQuery.data ?? []).map((row) => [row.companyName, row.phone])), [metaQuery.data]);
  const book = tracking.data?.creditDays ?? 30;
  const own = tracking.data?.companyCredit ?? {};
  const rows = useMemo(() => dueRows(entries, payments, (company) => own[company] ?? book), [entries, payments, own, book]);
  const late = rows.filter((row) => row.overdue > 0);
  const [open, setOpen] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [companyDays, setCompanyDays] = useState("");
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : late;

  async function saveDays(company?: string, value?: number | null) {
    const result = await saveCreditDays({ data: { companyName: company, days: value === undefined ? Number(days ?? book) : value } });
    setNote(result.ok ? (company ? `Credit days saved for ${company}.` : "Credit days saved.") : result.error);
    setDays(null);
    await client.invalidateQueries({ queryKey: ["tracking"] });
  }

  return (
    <Panel title="Reminders">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          Bills are due {book} day{book === 1 ? "" : "s"} after the bill date. {late.length ? `${late.length} compan${late.length === 1 ? "y is" : "ies are"} late.` : "Nobody is late right now."}
        </p>
        <p className="text-right">
          <span className={cn("block text-xl font-semibold tabular-nums", late.length ? "text-rust" : "text-pine")}>{rupee(late.reduce((sum, row) => sum + row.overdue, 0), 0)}</span>
          <span className="text-xs text-muted">past due</span>
        </p>
      </div>
      {isOwner ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Credit days">
            <input className="field w-28 tabular-nums" inputMode="numeric" value={days ?? String(book)} onChange={(event) => setDays(event.target.value.replace(/[^\d]/g, ""))} />
          </Field>
          <button type="button" className="btn btn-ghost" disabled={days == null || days === ""} onClick={() => void saveDays()}>
            Save
          </button>
        </div>
      ) : null}
      {note ? (
        <p className="mt-2 text-sm text-pine" role="status">
          {note}
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-line">
        {shown.length === 0 ? <li className="py-3 text-sm text-muted">{rows.length ? "No late bills. Tap below to see every balance." : "Nothing is due."}</li> : null}
        {shown.map((row) => {
          const text = reminderMessage({ yardName, row, dmy });
          const phone = phones.get(row.company);
          return (
            <li key={row.company} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" className="min-w-0 text-left" onClick={() => setOpen(open === row.company ? null : row.company)} aria-expanded={open === row.company}>
                  <p className="font-semibold">{row.company}</p>
                  <p className="text-xs text-muted">
                    {row.bills.length} bill{row.bills.length === 1 ? "" : "s"} open · {row.creditDays} credit days
                    {row.oldestLate ? ` · oldest ${row.oldestLate} days late` : ""}
                  </p>
                </button>
                <div className="text-right">
                  <p className={cn("font-semibold tabular-nums", row.overdue ? "text-rust" : "")}>{rupee(row.overdue || row.totalLeft, 0)}</p>
                  <p className="text-xs text-muted">{row.overdue ? `late · ${rupee(row.totalLeft, 0)} in all` : "not due yet"}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {waNumber(phone) ? (
                  <a className="btn btn-pine h-9 gap-2 px-3 text-sm" href={whatsappLink(phone, text)} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-4" aria-hidden /> WhatsApp reminder
                  </a>
                ) : (
                  <a className="btn btn-ghost h-9 gap-2 px-3 text-sm" href={whatsappLink("", text)} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-4" aria-hidden /> WhatsApp (pick contact)
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-ghost h-9 gap-2 px-3 text-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(text).then(
                      () => setNote(`Reminder for ${row.company} copied.`),
                      () => setNote("Couldn't copy here."),
                    );
                  }}
                >
                  <Copy className="size-4" aria-hidden /> Copy message
                </button>
              </div>
              {open === row.company ? (
                <div className="mt-3 grid gap-3 rounded-lg bg-paper/70 p-3">
                  <ul className="grid gap-1 text-sm">
                    {row.bills.map((bill) => (
                      <li key={`${bill.no}-${bill.date}`} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {bill.no} · {dmy(bill.date)}
                        </span>
                        <span className={cn("shrink-0 tabular-nums", bill.lateDays ? "text-rust" : "text-muted")}>
                          {rupee(bill.left)} · {bill.lateDays ? `${bill.lateDays}d late` : `due ${dmy(bill.due)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {isOwner ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label={`Credit days for ${row.company}`}>
                        <input className="field w-28 tabular-nums" inputMode="numeric" placeholder={String(book)} value={companyDays} onChange={(event) => setCompanyDays(event.target.value.replace(/[^\d]/g, ""))} />
                      </Field>
                      <button type="button" className="btn btn-ghost" onClick={() => void saveDays(row.company, companyDays === "" ? null : Number(companyDays)).then(() => setCompanyDays(""))}>
                        {companyDays === "" ? "Use book days" : "Save"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {rows.length > late.length ? (
        <button type="button" className="btn btn-ghost mt-2 h-9 gap-2 px-3 text-sm" onClick={() => setShowAll((value) => !value)}>
          <BellRing className="size-4" aria-hidden />
          {showAll ? "Show only late bills" : `Show all ${rows.length} open balances`}
        </button>
      ) : null}
    </Panel>
  );
}
