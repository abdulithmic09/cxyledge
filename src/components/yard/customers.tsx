import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BellRing, ChevronLeft, ChevronRight, FileText, IndianRupee, MessageCircle, Phone, Search, Share2 } from "lucide-react";
import { deleteDocument, listCompanyMeta, restoreDeleted, saveCompanyMeta, saveDocument, type DocRecord, type Entry, type Payment, type YardInfo } from "@/lib/inventory/api";
import { companyBalances, companyLedger, movementLabel, paymentLabel, type CompanyBalance } from "@/lib/inventory/analyse";
import { balanceMessage, waNumber, whatsappLink } from "@/lib/inventory/whatsapp";
import { getTracking } from "@/lib/inventory/tracking";
import { dueRows } from "@/lib/inventory/dues";
import { useRole } from "@/lib/inventory/role";
import { formatDay } from "@/lib/inventory/model";
import { downloadBlob, makePdf, shareBlob, toCsv } from "@/lib/inventory/files";
import { rupee } from "@/lib/inventory/serials";
import { cn } from "@/lib/cn";
import { PaymentsPanel } from "@/components/yard/payments-panel";
import { RatesPanel } from "@/components/yard/rates-panel";
import { DepositsPanel } from "@/components/yard/deposits-panel";
import { OverduePanel } from "@/components/yard/overdue-panel";
import { groupBills } from "@/components/yard/bill-views";
import { openEntrySheet } from "@/components/yard/entry-launcher";
import { requestBillEdit } from "@/lib/inventory/nav-requests";
import { ExportBar } from "@/components/yard/export-bar";
import { StatementPanel, statementUrl, useStatementLink } from "@/components/yard/statement-panel";
import { Field, PageHead, Panel, Stat, Tally } from "@/components/yard/ui";

type Filter = "all" | "out" | "due" | "late";

/** Customers: everyone you deal with, what they hold and owe, and one page per company. */
export function CustomersView({
  yard,
  entries,
  payments,
  documents,
  onChanged,
  initialCompany,
  onOpenBills,
}: {
  yard: YardInfo;
  entries: Entry[];
  payments: Payment[];
  documents: DocRecord[];
  onChanged: () => void;
  initialCompany?: string | null;
  onOpenBills: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(initialCompany ?? null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showReminders, setShowReminders] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const balances = useMemo(() => companyBalances(entries, payments), [entries, payments]);
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });
  const tracking = useQuery({ queryKey: ["tracking"], queryFn: () => getTracking() });
  const metaByName = useMemo(() => new Map((metaQuery.data ?? []).map((row) => [row.companyName, row])), [metaQuery.data]);
  const book = tracking.data?.creditDays ?? 30;
  const own = tracking.data?.companyCredit ?? {};
  const late = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of dueRows(entries, payments, (company) => own[company] ?? book)) if (row.overdue > 0) map.set(row.company, row.overdue);
    return map;
  }, [entries, payments, own, book]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [selected]);

  const stillOut = balances.reduce((sum, row) => sum + row.outstandingQty, 0);
  const toCollect = balances.reduce((sum, row) => sum + row.toCollect, 0);
  const lateTotal = [...late.values()].reduce((sum, value) => sum + value, 0);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = balances.filter((row) => {
      if (filter === "out" && row.outstandingQty <= 0) return false;
      if (filter === "due" && row.toCollect <= 0) return false;
      if (filter === "late" && !late.has(row.company)) return false;
      if (!needle) return true;
      const meta = metaByName.get(row.company);
      const entryText = entries
        .filter((entry) => entry.companyName === row.company)
        .map((entry) => [entry.entryDate, entry.serialNo, entry.billNo, entry.note, entry.cylinderType].join(" "))
        .join(" ");
      const docText = documents.filter((doc) => doc.companyName === row.company).map((doc) => doc.title).join(" ");
      return `${row.company} ${meta?.keywords ?? ""} ${meta?.notes ?? ""} ${meta?.phone ?? ""} ${entryText} ${docText}`.toLowerCase().includes(needle);
    });
    return list.sort(
      (a, b) =>
        (late.get(b.company) ?? 0) - (late.get(a.company) ?? 0) ||
        b.toCollect - a.toCollect ||
        b.outstandingQty - a.outstandingQty ||
        a.company.localeCompare(b.company),
    );
  }, [balances, filter, late, needle, metaByName, entries, documents]);

  const company = selected ? balances.find((row) => row.company === selected) : undefined;
  if (selected && company) {
    return (
      <CompanyPage
        yard={yard}
        balance={company}
        lateAmount={late.get(company.company) ?? 0}
        entries={entries}
        payments={payments}
        documents={documents}
        phone={metaByName.get(company.company)?.phone ?? ""}
        onChanged={onChanged}
        onBack={() => setSelected(null)}
        onOpenBills={onOpenBills}
      />
    );
  }

  const open = balances.filter((row) => row.outstandingQty > 0 || row.toCollect > 0);
  const types = [...new Set(open.flatMap((row) => row.byType.map((t) => t.type)))];
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const lines = [
    `Balance summary · ${today}`,
    `Cylinders at customers ${stillOut} · To collect ${rupee(toCollect)}`,
    "",
    ...open.flatMap((row) => [
      `${row.company}: ${row.outstandingQty} out · ${rupee(row.toCollect)} due`,
      ...row.byType.map((t) => `   ${t.type}: ${t.out}`),
      row.outstandingSerials.length ? `   Serials: ${row.outstandingSerials.join(", ")}` : "",
    ]),
  ].filter((line) => line !== "");
  const csv = toCsv(
    ["Company", "Cylinders out", ...types, "To collect", "Serials at customer"],
    open.map((row) => [row.company, String(row.outstandingQty), ...types.map((type) => String(row.byType.find((t) => t.type === type)?.out ?? 0)), String(row.toCollect), row.outstandingSerials.join(" ")]),
  );

  const counts: Record<Filter, number> = {
    all: balances.length,
    out: balances.filter((row) => row.outstandingQty > 0).length,
    due: balances.filter((row) => row.toCollect > 0).length,
    late: late.size,
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHead
        title="Customers"
        detail={`${balances.length} ${balances.length === 1 ? "company" : "companies"}`}
        action={
          open.length ? (
            <button type="button" className={cn("btn h-9 min-h-0 gap-1.5 px-3 text-sm", showShare ? "btn-pine" : "btn-ghost")} aria-expanded={showShare} onClick={() => setShowShare((value) => !value)}>
              <Share2 className="size-4" aria-hidden /> Share list
            </button>
          ) : null
        }
      />
      {showShare ? (
        <div className="card p-3">
          <ExportBar title="Cxyledge balance summary" filename="cxyledge-balance" lines={lines} csv={csv} />
        </div>
      ) : null}
      <Tally
        items={[
          { label: "Out", value: stillOut },
          { label: "To collect", value: rupee(toCollect, 0), tone: toCollect > 0 ? "rust" : undefined },
          { label: "Late", value: late.size ? rupee(lateTotal, 0) : "None", tone: late.size ? "rust" : undefined },
        ]}
      />

      <button
        type="button"
        className="flex items-center gap-2.5 card px-3.5 py-2.5 text-left text-sm hover:bg-sand"
        aria-expanded={showReminders}
        onClick={() => setShowReminders((value) => !value)}
      >
        <BellRing className={cn("size-4 shrink-0", late.size ? "text-rust" : "text-muted")} aria-hidden />
        <span className="min-w-0 flex-1">
          {late.size ? (
            <span className="font-medium">
              {late.size} late · send reminders
            </span>
          ) : (
            <>Reminders and credit days</>
          )}
        </span>
        <ChevronRight className={cn("size-4 shrink-0 text-muted transition-transform", showReminders && "rotate-90")} aria-hidden />
      </button>
      {showReminders ? <OverduePanel entries={entries} payments={payments} yardName={yard.name} /> : null}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field border-transparent pl-9 shadow-card" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, phone, serial or bill no." aria-label="Search customers" />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="seg" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["out", "Cylinders out"],
                ["due", "Money due"],
                ["late", "Late"],
              ] as Array<[Filter, string]>
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
                <span className="ml-1.5 tabular-nums opacity-60">{counts[id]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card px-4 py-8 text-center text-sm text-muted">
          {balances.length === 0 ? "No customers yet. They appear once you give cylinders or make a bill." : "No match. Try a serial number, a bill number or part of the name."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="label grid grid-cols-[minmax(0,1fr)_4rem_6.5rem_1rem] gap-3 border-b border-line bg-sand/50 px-4 py-2.5">
            <span>Company</span>
            <span className="text-right">Out</span>
            <span className="text-right">To collect</span>
            <span />
          </div>
          <ul>
            {rows.map((row) => {
              const overdue = late.get(row.company) ?? 0;
              return (
                <li key={row.company} className="border-b border-line last:border-b-0">
                  <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_4rem_6.5rem_1rem] items-center gap-3 px-4 py-3 text-left hover:bg-sand/60" onClick={() => setSelected(row.company)}>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{row.company}</span>
                        {overdue ? <span className="tag tag-due shrink-0">Late</span> : null}
                        {!row.toCollect && row.advance ? <span className="tag tag-ok shrink-0">Advance {rupee(row.advance, 0)}</span> : null}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {row.byType.length ? row.byType.map((t) => `${t.out} ${t.type}`).join(" · ") : "No cylinders out"}
                      </span>
                    </span>
                    <span className={cn("text-right font-bold tabular-nums", !row.outstandingQty && "font-normal text-muted")}>{row.outstandingQty}</span>
                    <span className={cn("text-right tabular-nums", row.toCollect ? "font-bold text-rust" : "text-muted")}>{row.toCollect ? rupee(row.toCollect, 0) : "—"}</span>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- one company ---------- */

type Tab = "ledger" | "payments" | "bills" | "deposits" | "rates" | "files" | "details";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "ledger", label: "Ledger" },
  { id: "payments", label: "Payments" },
  { id: "bills", label: "Bills" },
  { id: "deposits", label: "Deposits" },
  { id: "rates", label: "Rates" },
  { id: "files", label: "Files" },
  { id: "details", label: "Details" },
];

let lastTab: Tab = "ledger";

function CompanyPage({
  yard,
  balance,
  lateAmount,
  entries,
  payments,
  documents,
  phone,
  onChanged,
  onBack,
  onOpenBills,
}: {
  yard: YardInfo;
  balance: CompanyBalance;
  lateAmount: number;
  entries: Entry[];
  payments: Payment[];
  documents: DocRecord[];
  phone: string;
  onChanged: () => void;
  onBack: () => void;
  onOpenBills: () => void;
}) {
  const { canEdit } = useRole();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (next: Tab) => {
    lastTab = next;
    setTabState(next);
  };
  const company = balance.company;
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });
  const meta = metaQuery.data?.find((row) => row.companyName === company);
  const docs = documents.filter((doc) => doc.companyName === company);
  const digits = waNumber(phone);
  const [showStatement, setShowStatement] = useState(false);
  const statement = useStatementLink(company);
  const shareUrl = statement.data ? statementUrl(statement.data.token) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <section className="navy -mx-4 -mt-4 flex flex-col gap-3 px-5 pb-5 pt-3 lg:mx-0 lg:mt-0 lg:rounded-2xl lg:px-7 lg:pt-5">
        <button type="button" className="-ml-2 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white" onClick={onBack}>
          <ChevronLeft className="size-4" aria-hidden /> Customers
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="min-w-0 text-[1.75rem] leading-tight">{company}</h2>
          {lateAmount ? <span className="rounded-md bg-[#ffd9d4] px-2 py-0.5 text-xs font-bold text-[#9c2219]">{rupee(lateAmount, 0)} late</span> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-white/65">{!balance.toCollect && balance.advance ? "Advance paid" : "To collect"}</p>
            <p className="font-display text-[1.85rem] leading-tight tabular-nums">{rupee(!balance.toCollect && balance.advance ? balance.advance : balance.toCollect, 0)}</p>
            {!balance.toCollect && balance.advance ? <p className="text-xs text-white/65">Used on their next bills</p> : null}
          </div>
          <div>
            <p className="text-xs text-white/65">Cylinders out</p>
            <p className="font-display text-[1.85rem] leading-tight tabular-nums">{balance.outstandingQty}</p>
          </div>
        </div>
        {balance.byType.length || balance.outstandingSerials.length ? (
          <div className="text-sm text-white/80">
            {balance.byType.length ? <p>{balance.byType.map((t) => `${t.out} × ${t.type}`).join(" · ")}</p> : null}
            {balance.outstandingSerials.length ? (
              <p className="code mt-0.5 text-xs text-white/60">
                {balance.outstandingSerials.slice(0, 16).join(", ")}
                {balance.outstandingSerials.length > 16 ? ` +${balance.outstandingSerials.length - 16} more` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 [&>*]:h-10 [&>*]:min-h-0 [&>*]:px-3.5 [&>*]:text-sm">
          {canEdit ? (
            <>
              <button type="button" className="btn btn-gold gap-1.5 !shadow-none" onClick={() => openEntrySheet({ mode: "money", company })}>
                <IndianRupee className="size-4" aria-hidden /> Money received
              </button>
              <button type="button" className="btn gap-1.5 bg-white/12 text-white ring-1 ring-white/15 hover:bg-white/20" onClick={() => openEntrySheet({ mode: "give", company })}>
                <ArrowUpRight className="size-4" aria-hidden /> Give cylinders
              </button>
            </>
          ) : null}
          <a className="btn gap-1.5 bg-white/12 text-white ring-1 ring-white/15 hover:bg-white/20" href={whatsappLink(phone, balanceMessage({ yardName: yard.name, balance, statementUrl: shareUrl }))} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" aria-hidden /> WhatsApp
          </a>
          {digits ? (
            <a className="btn gap-1.5 bg-white/12 text-white ring-1 ring-white/15 hover:bg-white/20" href={`tel:+${digits}`}>
              <Phone className="size-4" aria-hidden /> Call
            </a>
          ) : (
            <button type="button" className="btn gap-1.5 bg-white/12 text-white/80 ring-1 ring-white/15 hover:bg-white/20" onClick={() => setTab("details")}>
              <Phone className="size-4" aria-hidden /> Add number
            </button>
          )}
          <button type="button" className="btn gap-1.5 bg-white/12 text-white ring-1 ring-white/15 hover:bg-white/20" aria-expanded={showStatement} onClick={() => setShowStatement((open) => !open)}>
            <FileText className="size-4" aria-hidden /> Statement link
          </button>
        </div>
      </section>
      {showStatement ? <StatementPanel yard={yard} balance={balance} phone={phone} onClose={() => setShowStatement(false)} /> : null}

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label={`${company} sections`}>
        <div className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === "files" && docs.length ? <span className="ml-1 tabular-nums opacity-70">{docs.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {tab === "ledger" ? <LedgerTab company={company} entries={entries} payments={payments} balance={balance} /> : null}
      {tab === "payments" ? <PaymentsPanel yard={yard} company={company} entries={entries} payments={payments} balance={balance} onChanged={onChanged} /> : null}
      {tab === "bills" ? <BillsTab company={company} entries={entries} documents={docs} onOpenBills={onOpenBills} /> : null}
      {tab === "deposits" ? <DepositsPanel yard={yard} company={company} /> : null}
      {tab === "rates" ? <RatesPanel company={company} types={yard.cylinderTypes} prices={meta?.prices ?? {}} /> : null}
      {tab === "files" ? <FilesTab company={company} documents={docs} onChanged={onChanged} /> : null}
      {tab === "details" ? <DetailsTab company={company} balance={balance} meta={meta} /> : null}
    </div>
  );
}

function LedgerTab({ company, entries, payments, balance }: { company: string; entries: Entry[]; payments: Payment[]; balance: CompanyBalance }) {
  const ledger = useMemo(() => companyLedger(entries, payments, company), [entries, payments, company]);
  const companyEntries = entries.filter((entry) => entry.companyName === company);
  const ledgerLines = ledger.map(
    (row) => `${row.date.split("-").reverse().join("/")}  ${row.particulars}  Dr ${row.debit ? rupee(row.debit) : "-"}  Cr ${row.credit ? rupee(row.credit) : "-"}  Bal ${rupee(row.balance)}`,
  );
  const ledgerCsv = toCsv(
    ["Date", "Particulars", "Debit (billed)", "Credit (received)", "Balance"],
    ledger.map((row) => [row.date.split("-").reverse().join("/"), row.particulars, row.debit ? String(row.debit) : "", row.credit ? String(row.credit) : "", String(row.balance)]),
  );
  const lines = [
    company,
    `Still out ${balance.outstandingQty}`,
    `Serials ${balance.outstandingSerials.join(", ") || "none"}`,
    ...balance.byType.map((row) => `  ${row.type}: ${row.out} out`),
    `To collect ${rupee(balance.toCollect)}`,
    `To pay ${rupee(balance.toPay)}`,
    `Delivered ${balance.delivered} · Returned ${balance.returned} · Purchased ${balance.purchased}`,
    "",
    ...companyEntries.map(
      (entry) => `${entry.entryDate}  ${movementLabel(entry.movement)}  ${entry.quantity}  ${entry.serialNo.replace(/\n/g, " ")}  ${entry.billNo}  ${paymentLabel(entry.paymentStatus)}  ${rupee(entry.amountDue)}`,
    ),
  ];
  const csv = toCsv(
    ["Date", "Movement", "Gas type", "Qty", "Serials", "Bill", "Payment", "Due", "Paid"],
    companyEntries.map((entry) => [
      entry.entryDate,
      movementLabel(entry.movement),
      entry.cylinderType,
      String(entry.quantity),
      entry.serialNo.replace(/\n/g, " "),
      entry.billNo,
      paymentLabel(entry.paymentStatus),
      entry.amountDue == null ? "" : String(entry.amountDue),
      entry.amountPaid == null ? "" : String(entry.amountPaid),
    ]),
  );
  return (
    <Panel title="Ledger">
      <p className="mb-3 text-xs text-muted">Balance is what {company} owes you. Below zero means you owe them.</p>
      {ledger.length === 0 ? (
        <p className="text-sm text-muted">No amounts recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-sand text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Particulars</th>
                <th className="px-3 py-2 text-right font-semibold">Debit</th>
                <th className="px-3 py-2 text-right font-semibold">Credit</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDay(row.date)}</td>
                  <td className="px-3 py-2">{row.particulars}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.debit ? rupee(row.debit, 0) : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-pine">{row.credit ? rupee(row.credit, 0) : ""}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{rupee(row.balance, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        <ExportBar title={`${company} ledger`} filename={`cxyledge-ledger-${slug(company)}`} lines={[company, "", ...ledgerLines]} csv={ledgerCsv} />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Cylinder movements and statement</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {companyEntries.slice(0, 40).map((entry) => (
              <li key={entry.id}>
                {formatDay(entry.entryDate)} · {movementLabel(entry.movement)} · {entry.quantity}
                {entry.cylinderType ? ` × ${entry.cylinderType}` : ""} · {paymentLabel(entry.paymentStatus)}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <ExportBar title={`${company} statement`} filename={`cxyledge-${slug(company)}`} lines={lines} csv={csv} />
          </div>
        </details>
      </div>
    </Panel>
  );
}

function BillsTab({ company, entries, documents, onOpenBills }: { company: string; entries: Entry[]; documents: DocRecord[]; onOpenBills: () => void }) {
  const { canEdit } = useRole();
  const bills = useMemo(() => groupBills(entries.filter((entry) => entry.companyName === company)), [entries, company]);
  const pdfFor = (billNo: string) => documents.find((doc) => doc.title.startsWith(billNo) && doc.content.startsWith("data:"));
  return (
    <Panel title="Bills">
      {bills.length === 0 ? (
        <p className="text-sm text-muted">No bills for {company} yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {bills.map((bill) => {
            const total = bill.total ?? 0;
            const due = Math.max(0, total - (bill.paid ?? 0));
            const doc = pdfFor(bill.billNo);
            const challan = bill.billNo.startsWith("DC/");
            return (
              <li key={bill.billNo} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {bill.billNo} <span className="font-normal text-muted">· {formatDay(bill.date)}</span>
                    {challan ? <span className="ml-2 rounded bg-pine/15 px-1.5 py-0.5 text-xs font-medium text-pine">Challan</span> : null}
                  </p>
                  <p className="text-xs text-muted">{bill.lines.map((line) => `${line.quantity} × ${line.cylinderType || "cylinders"}`).join(" · ")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-right tabular-nums">
                    {challan ? (
                      <span className="text-xs font-semibold text-rust">Not billed yet</span>
                    ) : (
                      <>
                        <span className="block font-semibold">{rupee(total, 0)}</span>
                        <span className={cn("block text-xs", due ? "text-rust" : "text-pine")}>{due ? `${rupee(due, 0)} due` : "Paid"}</span>
                      </>
                    )}
                  </span>
                  {doc ? (
                    <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => downloadDoc(doc)}>
                      PDF
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className={cn("btn h-9 px-3 text-sm", challan ? "btn-pine" : "btn-ghost")}
                      onClick={() => {
                        requestBillEdit(bill.billNo);
                        onOpenBills();
                      }}
                    >
                      {challan ? "Make bill" : "Edit"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn btn-ghost mt-3" onClick={onOpenBills}>
        Make a new bill
      </button>
    </Panel>
  );
}

function FilesTab({ company, documents, onChanged }: { company: string; documents: DocRecord[]; onChanged: () => void }) {
  const { canEdit, isOwner } = useRole();
  const [error, setError] = useState("");
  const [docUndo, setDocUndo] = useState<DocRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 280_000) {
      setError("Keep each file under 280 KB.");
      return;
    }
    const content = await readFile(file);
    const result = await saveDocument({ data: { companyName: company, title: file.name, kind: "upload", mime: file.type || "application/octet-stream", content } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Panel title="Files">
      {docUndo ? (
        <p className="mb-3 text-sm" role="status">
          {docUndo.title} deleted. It&apos;s in Recently deleted for 30 days.{" "}
          <button
            type="button"
            className="font-semibold text-pine underline"
            onClick={() => {
              void restoreDeleted({ data: { kind: "document", id: docUndo.id } }).then(() => {
                setDocUndo(null);
                onChanged();
              });
            }}
          >
            Undo
          </button>
        </p>
      ) : null}
      {canEdit ? (
        <Field label="Upload a bill, photo, or PDF" hint="Stored in this account and visible on every signed-in device. 280 KB each.">
          <input
            className="field py-2"
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv"
            onChange={(event) => {
              void onUpload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </Field>
      ) : null}
      {error ? <p className="mt-2 text-sm text-rust">{error}</p> : null}
      {documents.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No files for this company yet. Saved bills land here too.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{doc.title}</p>
                <p className="text-xs text-muted">
                  {doc.kind} · {new Date(doc.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => downloadDoc(doc)}>
                  Download
                </button>
                <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => void shareDoc(doc)}>
                  Share
                </button>
                {!isOwner ? null : pendingDelete === doc.id ? (
                  <button
                    type="button"
                    className="btn btn-rust h-9 px-3 text-sm"
                    onClick={() => {
                      void deleteDocument({ data: doc.id }).then((result) => {
                        setPendingDelete(null);
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        setDocUndo(doc);
                        onChanged();
                      });
                    }}
                  >
                    Delete
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => setPendingDelete(doc.id)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DetailsTab({
  company,
  balance,
  meta,
}: {
  company: string;
  balance: CompanyBalance;
  meta: { keywords: string; notes: string; phone: string } | undefined;
}) {
  const { canEdit } = useRole();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState(meta?.phone ?? "");
  const [keywords, setKeywords] = useState(meta?.keywords ?? "");
  const [notes, setNotes] = useState(meta?.notes ?? "");
  const [state, setState] = useState("");

  useEffect(() => {
    setPhone(meta?.phone ?? "");
    setKeywords(meta?.keywords ?? "");
    setNotes(meta?.notes ?? "");
  }, [meta?.phone, meta?.keywords, meta?.notes]);

  async function save() {
    setState("Saving…");
    const result = await saveCompanyMeta({ data: { companyName: company, keywords, notes, phone } });
    if (!result.ok) {
      setState(result.error);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["company-meta"] });
    setState("Saved");
  }

  return (
    <Panel title="Details">
      <fieldset disabled={!canEdit} className="contents">
        <div className="grid gap-3">
          <Field label="WhatsApp / phone number" hint="10-digit mobile number. Used for WhatsApp and Call.">
            <input className="field" inputMode="tel" value={phone} maxLength={20} onChange={(event) => setPhone(event.target.value)} placeholder="98765 43210" />
          </Field>
          <Field label="Keywords" hint="Words you might search by: area, industry, contact person.">
            <input className="field" value={keywords} maxLength={300} onChange={(event) => setKeywords(event.target.value)} placeholder="hospital, Bhosari, welding" />
          </Field>
          <Field label="Notes">
            <textarea className="field field-area min-h-20" value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} placeholder="Billing contact, credit terms, delivery timings" />
          </Field>
          {canEdit ? (
            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-pine" onClick={() => void save()}>
                Save
              </button>
              {state ? <span className="text-sm text-muted">{state}</span> : null}
            </div>
          ) : null}
        </div>
      </fieldset>
      <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
        Delivered {balance.delivered} · returned {balance.returned} · purchased {balance.purchased} · you owe them {rupee(balance.toPay, 0)}
        {balance.lastUpdated ? ` · last activity ${new Date(balance.lastUpdated).toLocaleDateString("en-IN")}` : ""}
      </p>
    </Panel>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function downloadDoc(doc: DocRecord) {
  if (doc.content.startsWith("data:")) {
    const link = document.createElement("a");
    link.href = doc.content;
    link.download = doc.title;
    link.click();
    return;
  }
  downloadBlob(`${doc.title}.pdf`, makePdf(doc.title, doc.content.split("\n")));
}

async function shareDoc(doc: DocRecord) {
  if (doc.content.startsWith("data:")) {
    const response = await fetch(doc.content);
    const blob = await response.blob();
    await shareBlob(doc.title, blob, doc.title);
    return;
  }
  await shareBlob(`${doc.title}.pdf`, makePdf(doc.title, doc.content.split("\n")), doc.title);
}
