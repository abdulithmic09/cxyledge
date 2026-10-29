import { createFileRoute } from "@tanstack/react-router";
import { Cylinder, Printer } from "lucide-react";
import { readStatement, type PublicStatement } from "@/lib/inventory/statement";
import { rupee } from "@/lib/inventory/serials";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/s/$token")({
  loader: ({ params }) => readStatement({ data: params.token }),
  head: () => ({ meta: [{ title: "Statement" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: StatementPage,
  staleTime: 0,
});

/** DD/MM/YYYY */
const formatDay = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function StatementPage() {
  const result = Route.useLoaderData();
  if (!result.ok) return <Missing />;
  return <Statement s={result.statement} />;
}

function Missing() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 text-ink">
      <div className="card max-w-sm px-6 py-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-ink text-paper">
          <Cylinder className="size-5" aria-hidden />
        </span>
        <h1 className="mt-3 text-xl">This link is not active</h1>
        <p className="mt-1.5 text-sm text-muted">The statement link may have been turned off. Please ask your gas agency for a new one.</p>
      </div>
    </main>
  );
}

function Statement({ s }: { s: PublicStatement }) {
  const asOf = new Date(s.asOf);
  const asOfText = `${asOf.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" })}, ${asOf.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}`;
  const recent = [...s.ledger].reverse().slice(0, 120);
  return (
    <main className="min-h-screen bg-paper pb-12 text-ink print:bg-white">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {s.yard.logo ? (
            <img src={s.yard.logo} alt="" className="size-10 rounded-lg object-contain" />
          ) : (
            <span className="grid size-10 place-items-center rounded-xl bg-ink text-paper">
              <Cylinder className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg leading-tight">{s.yard.name}</p>
            <p className="truncate text-xs text-muted">{[s.yard.address, s.yard.phone, s.yard.email].filter(Boolean).join(" · ")}</p>
          </div>
          <button type="button" className="btn btn-ghost h-9 min-h-0 gap-1.5 px-3 text-sm print:hidden" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-4">
        <section className="navy rounded-2xl px-5 pb-5 pt-4 print:bg-none print:text-ink">
          <p className="text-xs text-white/70 print:text-muted">Statement for</p>
          <h1 className="text-[1.6rem] leading-tight">{s.company}</h1>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-white/70 print:text-muted">{!s.toCollect && s.advance ? "Advance with us" : "Amount due"}</p>
              <p className="font-display text-[1.9rem] leading-tight tabular-nums">{rupee(!s.toCollect && s.advance ? s.advance : s.toCollect, 0)}</p>
              {s.overdue > 0 ? <p className="text-xs font-semibold text-[#ffd9d4] print:text-rust">{rupee(s.overdue, 0)} past due</p> : null}
            </div>
            <div>
              <p className="text-xs text-white/70 print:text-muted">Cylinders with you</p>
              <p className="font-display text-[1.9rem] leading-tight tabular-nums">{s.cylindersOut}</p>
              {s.byType.length ? <p className="text-xs text-white/75 print:text-muted">{s.byType.map((t) => `${t.out} × ${t.type}`).join(" · ")}</p> : null}
            </div>
          </div>
          <p className="mt-3 text-xs text-white/60 print:text-muted">As of {asOfText}</p>
        </section>

        {s.bills.length ? (
          <section className="card p-4">
            <h2 className="text-lg">Bills not yet paid</h2>
            <p className="text-xs text-muted">Payment is due {s.creditDays} days after the bill date.</p>
            <ul className="mt-2 divide-y divide-line">
              {s.bills.map((bill, index) => (
                <li key={`${bill.no}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="code">{bill.no === "Entry" ? "Delivery" : bill.no}</span>
                    <span className="block text-xs text-muted">
                      {formatDay(bill.date)} · due {formatDay(bill.due)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{rupee(bill.left, 0)}</span>
                    {bill.lateDays > 0 ? <span className="tag tag-due">{bill.lateDays} days late</span> : bill.left < bill.amount ? <span className="tag tag-part">Part paid</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {s.serials.length || s.depositHeld ? (
          <section className="card p-4">
            <h2 className="text-lg">Cylinders with you</h2>
            {s.serials.length ? <p className="code mt-1.5 text-xs leading-relaxed">{s.serials.join(", ")}</p> : null}
            {s.depositHeld ? <p className="mt-2 text-sm text-muted">Security deposit with us: {rupee(s.depositHeld, 0)}</p> : null}
          </section>
        ) : null}

        <section className="card overflow-hidden">
          <div className="px-4 pt-4">
            <h2 className="text-lg">Account</h2>
            <p className="text-xs text-muted">Newest first{s.ledger.length > recent.length ? ` · last ${recent.length} lines` : ""}</p>
          </div>
          {recent.length ? (
            <ul className="mt-2 border-t border-line">
              {recent.map((row) => (
                <li key={row.key} className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                  <span className="min-w-0">
                    <span className="block">{row.particulars}</span>
                    <span className="block text-xs tabular-nums text-muted">{formatDay(row.date)}</span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    {row.debit ? <span className="block font-semibold">+ {rupee(row.debit, 0)}</span> : null}
                    {row.credit ? <span className="block font-semibold text-pine">− {rupee(row.credit, 0)}</span> : null}
                    <span className={cn("block text-xs text-muted", row.balance < 0 && "text-pine")}>
                      Balance {row.balance < 0 ? `${rupee(-row.balance, 0)} advance` : rupee(row.balance, 0)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 pt-2 text-sm text-muted">No bills or payments yet.</p>
          )}
        </section>
        <p className="text-center text-xs text-muted">If anything here looks wrong, please contact {s.yard.name}{s.yard.phone ? ` on ${s.yard.phone}` : ""}.</p>
      </div>
    </main>
  );
}
