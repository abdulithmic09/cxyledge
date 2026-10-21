import { useMemo, useState } from "react";
import type { Entry } from "@/lib/inventory/api";
import { companyBalances } from "@/lib/inventory/analyse";
import { toCsv } from "@/lib/inventory/files";
import { rupee } from "@/lib/inventory/serials";
import { ExportBar } from "@/components/yard/export-bar";
import { Panel, Stat } from "@/components/yard/ui";

/** Cylinders still at each customer's premises, with type breakdown, serials and money due. */
export function BalancesView({ entries, onOpenCompany }: { entries: Entry[]; onOpenCompany: (company: string) => void }) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => companyBalances(entries), [entries]);
  const open = all.filter((row) => row.outstandingQty > 0 || row.toCollect > 0);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? open.filter((row) =>
        `${row.company} ${row.outstandingSerials.join(" ")} ${row.byType.map((t) => t.type).join(" ")}`.toLowerCase().includes(needle),
      )
    : open;
  const stillOut = open.reduce((total, row) => total + row.outstandingQty, 0);
  const toCollect = open.reduce((total, row) => total + row.toCollect, 0);
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
    ["Company", "Cylinders out", ...types, "To collect", "Serials at customer", "Last updated"],
    open.map((row) => [
      row.company,
      String(row.outstandingQty),
      ...types.map((type) => String(row.byType.find((t) => t.type === type)?.out ?? 0)),
      String(row.toCollect),
      row.outstandingSerials.join(" "),
      row.lastUpdated ? new Date(row.lastUpdated).toLocaleString("en-IN") : "",
    ]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl">Balance</h2>
        <p className="mt-1 text-sm text-muted">Cylinders still at each customer&apos;s premises, and money still to collect.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Cylinders at customers" value={stillOut} tone="rust" />
        <Stat label="To collect" value={rupee(toCollect, 0)} tone="pine" />
      </div>
      <input
        className="field"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a company, serial no. or cylinder type"
        aria-label="Find in balances"
      />
      {open.length === 0 ? (
        <Panel title="All clear">
          <p className="text-sm text-muted">No cylinders are out and nothing is due. Balances appear here as soon as a delivery is booked.</p>
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((row) => (
            <button
              key={row.company}
              type="button"
              className="rounded-xl border border-line bg-card p-4 text-left hover:border-rust"
              onClick={() => onOpenCompany(row.company)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-xl leading-tight">{row.company}</h3>
                <span className="shrink-0 rounded-full bg-sand px-2.5 py-1 text-xs font-semibold text-rust">{rupee(row.toCollect, 0)} due</span>
              </div>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-rust">
                {row.outstandingQty}
                <span className="ml-2 text-sm font-normal text-muted">cylinders at customer</span>
              </p>
              {row.byType.length ? (
                <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                  {row.byType.map((t) => (
                    <li key={t.type} className="flex justify-between gap-2">
                      <span>{t.type}</span>
                      <span className="tabular-nums">{t.out}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {row.outstandingSerials.length ? (
                <p className="mt-2 text-xs text-muted">
                  {row.outstandingSerials.slice(0, 12).join(", ")}
                  {row.outstandingSerials.length > 12 ? ` +${row.outstandingSerials.length - 12} more` : ""}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                Last updated {row.lastUpdated ? new Date(row.lastUpdated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
              </p>
            </button>
          ))}
        </div>
      )}
      {open.length ? (
        <Panel title="Share the balance">
          <ExportBar title="Cxyledge balance summary" filename="cxyledge-balance" lines={lines} csv={csv} />
        </Panel>
      ) : null}
    </div>
  );
}
