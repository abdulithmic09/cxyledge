import { useMemo, useState } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Entry, Payment, PaymentStatus } from "@/lib/inventory/api";
import {
  inRange,
  movementLabel,
  movementSeries,
  paymentLabel,
  periodBounds,
  topCompanies,
  totalsFor,
  type Period,
} from "@/lib/inventory/analyse";
import { formatDay, todayISO } from "@/lib/inventory/model";
import { rupee } from "@/lib/inventory/serials";
import { toCsv } from "@/lib/inventory/files";
import { cn } from "@/lib/cn";
import { ExportBar } from "@/components/yard/export-bar";
import { Panel, Stat } from "@/components/yard/ui";

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Custom" },
];

export default function AnalyticsView({ entries, payments = [], yardName }: { entries: Entry[]; payments?: Payment[]; yardName: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [company, setCompany] = useState("all");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [tab, setTab] = useState<"cylinders" | "companies" | "lines">("cylinders");
  const [showFilters, setShowFilters] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const today = todayISO();
  const bounds = periodBounds(period, today, customFrom || today, customTo || today);
  const companies = useMemo(() => [...new Set(entries.map((entry) => entry.companyName))].sort(), [entries]);

  const scoped = useMemo(() => {
    return entries.filter((entry) => {
      if (company !== "all" && entry.companyName !== company) return false;
      if (!inRange(entry, bounds.from, bounds.to)) return false;
      if (status !== "all" && entry.movement !== "return" && entry.paymentStatus !== status) return false;
      return true;
    });
  }, [entries, company, bounds.from, bounds.to, status]);

  const moneyRows = scoped.filter((entry) => status === "all" || entry.movement === "return" || entry.paymentStatus === status);
  // Payments recorded in this period count towards Received; a payment-status filter looks at bills only.
  const periodPayments = status === "all" ? payments.filter((payment) => (company === "all" || payment.companyName === company) && payment.paidOn >= bounds.from && payment.paidOn <= bounds.to) : [];
  const totals = totalsFor(moneyRows, today, periodPayments);
  const series = useMemo(() => movementSeries(scoped.filter((entry) => status === "all" || entry.paymentStatus === status || entry.movement === "return"), bounds.from, bounds.to), [scoped, bounds.from, bounds.to, status]);
  const leaders = topCompanies(scoped.filter((entry) => entry.movement === "delivery"));
  const busiest = [...series].sort((a, b) => b.delivered - a.delivered)[0];

  const lines = [
    `${yardName} · ${bounds.label}`,
    `${bounds.from} to ${bounds.to}`,
    company === "all" ? "All companies" : company,
    "",
    `Billed ${rupee(totals.billed)}`,
    `Received ${rupee(totals.paid)}`,
    `To collect ${rupee(totals.toCollect)}`,
    `To pay ${rupee(totals.toPay)}`,
    `Overdue (open more than 7 days) ${rupee(totals.overdue)}`,
    `Delivered ${totals.delivered}`,
    `Returned ${totals.returned}`,
    `Purchased ${totals.purchased}`,
    "",
    "Date | Company | Movement | Qty | Serials | Bill | Payment | Due | Paid",
    ...scoped.map(
      (entry) =>
        `${entry.entryDate} | ${entry.companyName} | ${movementLabel(entry.movement)} | ${entry.quantity} | ${entry.serialNo.replace(/\n/g, " ")} | ${entry.billNo} | ${paymentLabel(entry.paymentStatus)} | ${entry.amountDue ?? ""} | ${entry.amountPaid ?? ""}`,
    ),
  ];
  const csv = toCsv(
    ["Date", "Company", "Movement", "Qty", "Serials", "Bill", "Payment", "Due", "Paid", "Note"],
    scoped.map((entry) => [
      entry.entryDate,
      entry.companyName,
      movementLabel(entry.movement),
      String(entry.quantity),
      entry.serialNo.replace(/\n/g, " "),
      entry.billNo,
      paymentLabel(entry.paymentStatus),
      entry.amountDue == null ? "" : String(entry.amountDue),
      entry.amountPaid == null ? "" : String(entry.amountPaid),
      entry.note,
    ]),
  );

  if (entries.length === 0) {
    return (
      <Panel title="Nothing to analyse yet">
        <p className="text-sm text-muted">Add deliveries in the book, or load the sample week. Day, week, month, and year totals show up here.</p>
      </Panel>
    );
  }

  const filtered = company !== "all" || status !== "all";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Analytics</h2>
          <p className="mt-1 text-sm text-muted">
            {bounds.label}
            {company !== "all" ? ` · ${company}` : ""}
            {status !== "all" ? ` · ${paymentLabel(status)}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={cn("btn h-10 gap-2 px-3 text-sm", showFilters || filtered ? "btn-pine" : "btn-ghost")} aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}>
            <SlidersHorizontal className="size-4" aria-hidden /> Filters{filtered ? " on" : ""}
          </button>
          <button type="button" className={cn("btn h-10 gap-2 px-3 text-sm", showExport ? "btn-pine" : "btn-ghost")} aria-expanded={showExport} onClick={() => setShowExport((value) => !value)}>
            <Download className="size-4" aria-hidden /> Export
          </button>
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-xl border border-line bg-card p-1">
          {PERIODS.map((item) => (
            <button key={item.id} type="button" className={cn("btn h-9 shrink-0 px-4 text-sm", period === item.id ? "btn-pine" : "")} onClick={() => setPeriod(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {period === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className="field" aria-label="From" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          <input type="date" className="field" aria-label="To" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
        </div>
      ) : null}
      {showFilters ? (
        <div className="grid gap-2 rounded-xl border border-line bg-card p-3 sm:grid-cols-[1fr_1fr_auto]">
          <select className="field" aria-label="Company" value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="all">All companies</option>
            {companies.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select className="field" aria-label="Payment" value={status} onChange={(event) => setStatus(event.target.value as PaymentStatus | "all")}>
            <option value="all">Any payment</option>
            <option value="unpaid">Not received</option>
            <option value="partial">Part received</option>
            <option value="received">Received</option>
          </select>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!filtered}
            onClick={() => {
              setCompany("all");
              setStatus("all");
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
      {showExport ? (
        <div className="rounded-xl border border-line bg-card p-3">
          <ExportBar title={`${yardName} analytics`} filename="cxyledge-analytics" lines={lines} csv={csv} />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Received" value={rupee(totals.paid, 0)} tone="pine" />
        <Stat label="To collect" value={rupee(totals.toCollect, 0)} tone="rust" />
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-card px-3 py-3 text-center text-sm">
        <p>
          <span className="block font-display text-2xl tabular-nums text-rust">{totals.delivered}</span>
          <span className="text-xs text-muted">given</span>
        </p>
        <p>
          <span className="block font-display text-2xl tabular-nums text-pine">{totals.returned}</span>
          <span className="text-xs text-muted">returned</span>
        </p>
        <p>
          <span className="block font-display text-2xl tabular-nums">{totals.purchased}</span>
          <span className="text-xs text-muted">bought</span>
        </p>
      </div>
      <p className="text-sm leading-relaxed text-muted">
        {busiest && busiest.delivered > 0 ? `Busiest: ${busiest.label}, ${busiest.delivered} given. ` : ""}
        {leaders[0] ? `${leaders[0].company} owes the most at ${rupee(leaders[0].balance, 0)}. ` : ""}
        {totals.overdue > 0 ? `${rupee(totals.overdue, 0)} has been open more than a week.` : "Nothing is open more than a week."}
        {totals.toPay > 0 ? ` You owe suppliers ${rupee(totals.toPay, 0)}.` : ""}
      </p>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Analytics views">
        <div className="flex w-max gap-1 rounded-xl border border-line bg-card p-1">
          {(
            [
              ["cylinders", "Cylinders"],
              ["companies", "Top companies"],
              ["lines", `Lines (${scoped.length})`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn("btn h-9 shrink-0 px-3 text-sm", tab === id ? "btn-pine" : "")} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "cylinders" ? (
        <Panel title="Given and returned">
          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--color-sand)" }} content={<ChartTip />} />
                <Bar dataKey="delivered" fill="var(--color-rust)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="returned" fill="var(--color-pine)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-4 text-sm font-semibold">Cylinders out over time</p>
          <div className="mt-2 h-44 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="outstanding" stroke="var(--color-ink)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}

      {tab === "companies" ? (
        <Panel title="Top companies">
          {leaders.length === 0 ? (
            <p className="text-sm text-muted">No deliveries in this range.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {leaders.map((row) => (
                <li key={row.company} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{row.company}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {row.cylinders} cyl. · {rupee(row.balance, 0)} due
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {tab === "lines" ? (
        <Panel title="Lines in this range">
          <ul className="flex flex-col gap-3">
            {scoped.slice(0, 40).map((entry) => (
              <li key={entry.id} className="border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                <p className="font-medium">
                  {entry.companyName} · {movementLabel(entry.movement)} · {entry.quantity}
                </p>
                <p className="text-muted">
                  {formatDay(entry.entryDate)}
                  {entry.movement === "return" ? "" : ` · ${paymentLabel(entry.paymentStatus)} · ${rupee(entry.amountDue)}`}
                  {entry.serialNo ? ` · ${entry.serialNo.replace(/\n/g, ", ")}` : ""}
                </p>
              </li>
            ))}
          </ul>
          {scoped.length > 40 ? <p className="mt-3 text-xs text-muted">Showing 40 of {scoped.length}. Export includes every line.</p> : null}
        </Panel>
      ) : null}
    </div>
  );
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; dataKey?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-sm">
      <p className="font-medium">{label}</p>
      {payload.map((item) => (
        <p key={String(item.dataKey)} className="tabular-nums text-muted">
          {item.dataKey} {item.value}
        </p>
      ))}
    </div>
  );
}
