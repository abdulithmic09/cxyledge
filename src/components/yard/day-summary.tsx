import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, MessageCircle, Printer } from "lucide-react";
import type { Entry, Payment, YardInfo } from "@/lib/inventory/api";
import { companyBalances } from "@/lib/inventory/analyse";
import { getTracking } from "@/lib/inventory/tracking";
import { addDays, todayISO } from "@/lib/inventory/model";
import { rupee } from "@/lib/inventory/serials";
import { whatsappLink } from "@/lib/inventory/whatsapp";
import { cn } from "@/lib/cn";
import { PageHead, Panel, Tally } from "@/components/yard/ui";

const MODE_WORD: Record<string, string> = { cash: "Cash", upi: "UPI", cheque: "Cheque", bank: "Bank transfer", other: "Other", bill: "Paid with bills" };

/** DD/MM/YYYY */
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const money = (value: number) => rupee(Math.round(value), 0);
const signed = (value: number) => (value > 0 ? `+ ${money(value)}` : value < 0 ? `− ${money(-value)}` : money(0));

type TypeCount = Array<{ type: string; qty: number }>;

function byType(rows: Array<{ type: string; qty: number }>): TypeCount {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.type || "Unspecified", (map.get(row.type || "Unspecified") ?? 0) + row.qty);
  return [...map.entries()].map(([type, qty]) => ({ type, qty })).sort((a, b) => b.qty - a.qty || a.type.localeCompare(b.type));
}
const total = (list: TypeCount) => list.reduce((sum, row) => sum + row.qty, 0);
const typeLine = (list: TypeCount) => list.map((row) => `${row.qty} ${row.type}`).join(" · ");

/** End of day: cylinders out and in, money collected and paid, and new dues, for one day. */
export function DaySummary({ yard, entries, payments }: { yard: YardInfo; entries: Entry[]; payments: Payment[] }) {
  const today = todayISO();
  const [day, setDay] = useState(today);
  const tracking = useQuery({ queryKey: ["tracking"], queryFn: () => getTracking() });
  const moves = tracking.data?.moves ?? [];

  const s = useMemo(() => {
    const parentType = new Map(entries.map((entry) => [entry.id, entry.cylinderType]));
    const typeOf = (entry: Entry) => entry.cylinderType || (entry.parentId ? parentType.get(entry.parentId) : "") || "";
    const mine = entries.filter((entry) => entry.entryDate === day);
    const given = byType(mine.filter((e) => e.movement === "delivery").map((e) => ({ type: typeOf(e), qty: e.quantity })));
    const back = byType(mine.filter((e) => e.movement === "return").map((e) => ({ type: typeOf(e), qty: e.quantity })));
    const bought = byType(mine.filter((e) => e.movement === "purchase" && !e.parentId?.startsWith("plant:")).map((e) => ({ type: typeOf(e), qty: e.quantity })));
    const dayMoves = moves.filter((move) => move.date === day);
    const toPlant = byType(dayMoves.filter((m) => m.kind === "to_plant").map((m) => ({ type: m.gasType, qty: m.quantity })));
    const fromPlant = byType(dayMoves.filter((m) => m.kind === "from_plant").map((m) => ({ type: m.gasType, qty: m.quantity })));

    const sales = mine.filter((e) => e.movement === "delivery");
    const billed = sales.reduce((sum, e) => sum + (e.amountDue ?? 0), 0);
    const paidWithBills = sales.reduce((sum, e) => sum + (e.amountPaid ?? 0), 0);
    const dayPay = payments.filter((p) => p.paidOn === day);
    const modes = new Map<string, number>();
    if (paidWithBills) modes.set("bill", paidWithBills);
    for (const p of dayPay.filter((p) => p.direction === "in")) modes.set(p.mode, (modes.get(p.mode) ?? 0) + p.amount);
    const collected = [...modes.values()].reduce((sum, n) => sum + n, 0);
    const paidOut =
      dayPay.filter((p) => p.direction === "out").reduce((sum, p) => sum + p.amount, 0) +
      mine.filter((e) => e.movement === "purchase").reduce((sum, e) => sum + (e.amountPaid ?? 0), 0);
    // How much more (or less) the whole book is owed after today.
    const duesChange = Math.round(billed - collected);

    const people = new Map<string, { given: number; back: number; billed: number; paid: number }>();
    const slot = (name: string) => {
      const row = people.get(name) ?? { given: 0, back: 0, billed: 0, paid: 0 };
      people.set(name, row);
      return row;
    };
    for (const e of mine) {
      if (e.movement === "delivery") {
        const row = slot(e.companyName);
        row.given += e.quantity;
        row.billed += e.amountDue ?? 0;
        row.paid += e.amountPaid ?? 0;
      } else if (e.movement === "return") slot(e.companyName).back += e.quantity;
    }
    for (const p of dayPay) if (p.direction === "in") slot(p.companyName).paid += p.amount;
    const customers = [...people.entries()]
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.given - a.given || b.paid - a.paid || a.name.localeCompare(b.name));

    const balances = companyBalances(entries, payments);
    const toCollect = balances.reduce((sum, row) => sum + row.toCollect, 0);
    const cylindersOut = balances.reduce((sum, row) => sum + row.outstandingQty, 0);
    const lines = mine.length + dayPay.length + dayMoves.length;
    return { given, back, bought, toPlant, fromPlant, billed, collected, modes, paidOut, duesChange, customers, toCollect, cylindersOut, lines };
  }, [entries, payments, moves, day]);

  const message = useMemo(() => {
    const out = [`*${yard.name}: day summary ${dmy(day)}*`, ""];
    out.push(`Cylinders given: ${total(s.given)}${s.given.length ? ` (${typeLine(s.given)})` : ""}`);
    out.push(`Taken back: ${total(s.back)}${s.back.length ? ` (${typeLine(s.back)})` : ""}`);
    if (total(s.toPlant)) out.push(`Sent to plant: ${total(s.toPlant)} (${typeLine(s.toPlant)})`);
    if (total(s.fromPlant)) out.push(`Back from plant: ${total(s.fromPlant)} (${typeLine(s.fromPlant)})`);
    if (total(s.bought)) out.push(`Bought: ${total(s.bought)} (${typeLine(s.bought)})`);
    out.push("", `Bills made: ${money(s.billed)}`, `Money collected: ${money(s.collected)}`);
    for (const [mode, amount] of s.modes) out.push(`  • ${MODE_WORD[mode] ?? mode}: ${money(amount)}`);
    if (s.paidOut) out.push(`Paid to suppliers: ${money(s.paidOut)}`);
    out.push(`Change in dues: ${signed(s.duesChange)}`, "", `Total to collect now: ${money(s.toCollect)}`, `Cylinders with customers now: ${s.cylindersOut}`);
    return out.join("\n");
  }, [s, day, yard.name]);

  /** A clean A4 page of this day, printed from a hidden frame so the app's screen layout isn't used. */
  const printReport = () => {
    const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const now = new Date();
    const printed = `${now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" })}, ${now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}`;
    const row = (label: string, value: string, detail = "", tone = "") =>
      `<tr><td>${esc(label)}${detail ? `<div class="sub">${esc(detail)}</div>` : ""}</td><td class="num ${tone}">${esc(value)}</td></tr>`;
    const cyl = [
      row("Given to customers", String(total(s.given)), typeLine(s.given)),
      row("Taken back", String(total(s.back)), typeLine(s.back), total(s.back) ? "ok" : ""),
      row("Sent to plant", String(total(s.toPlant)), typeLine(s.toPlant)),
      row("Back full from plant", String(total(s.fromPlant)), typeLine(s.fromPlant)),
      total(s.bought) ? row("Bought", String(total(s.bought)), typeLine(s.bought)) : "",
    ].join("");
    const cash = [
      row("Bills made", money(s.billed)),
      row("Collected", money(s.collected), "", s.collected ? "ok" : ""),
      ...[...s.modes].map(([mode, amount]) => `<tr class="mode"><td>${esc(MODE_WORD[mode] ?? mode)}</td><td class="num">${esc(money(amount))}</td></tr>`),
      row("Paid to suppliers", money(s.paidOut)),
      row("Change in dues", signed(s.duesChange), "", s.duesChange > 0 ? "due" : s.duesChange < 0 ? "ok" : ""),
    ].join("");
    const people = s.customers.length
      ? `<h2>By customer</h2><table class="grid"><thead><tr><th>Company</th><th class="num">Given</th><th class="num">Returned</th><th class="num">Billed</th><th class="num">Paid</th></tr></thead><tbody>${s.customers
          .map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.given || "–"}</td><td class="num">${c.back || "–"}</td><td class="num">${c.billed ? esc(money(c.billed)) : "–"}</td><td class="num ok">${c.paid ? esc(money(c.paid)) : "–"}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="empty">Nothing recorded on ${esc(dmy(day))}.</p>`;
    const kpi = (label: string, value: string, tone = "") => `<div class="kpi"><div class="k">${esc(label)}</div><div class="v ${tone}">${esc(value)}</div></div>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`${yard.name} - Day summary ${dmy(day)}`)}</title>
<style>
@page{size:A4;margin:14mm 14mm 16mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Helvetica Neue",Arial,sans-serif;color:#1c1915;font-size:11pt;line-height:1.35}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #1e4d3c;padding-bottom:10px;margin-bottom:14px;gap:16px}
.brand{display:flex;gap:12px;align-items:center}.brand img{height:44px;max-width:110px;object-fit:contain}
.name{font-family:Georgia,"Times New Roman",serif;font-size:19pt;font-weight:700;color:#1e4d3c}
.addr{font-size:9pt;color:#6b6257;margin-top:2px}
.title{text-align:right}.title .t{font-family:Georgia,serif;font-size:15pt;font-weight:700}.title .d{font-size:10pt;color:#6b6257}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
.kpi{border:1px solid #e4dccd;border-radius:8px;padding:8px 10px;background:#faf7f1}
.k{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#6b6257;font-weight:600}.v{font-family:Georgia,serif;font-size:16pt;font-weight:700;margin-top:2px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
h2{font-family:Georgia,serif;font-size:12.5pt;margin:0 0 6px;color:#1e4d3c}
table{width:100%;border-collapse:collapse}
td,th{padding:6px 4px;border-bottom:1px solid #ece5d8;vertical-align:top;text-align:left}
th{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#6b6257;border-bottom:1.5px solid #cfc5b3}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600}
.sub{font-size:8.5pt;color:#6b6257;margin-top:1px}
tr.mode td{padding-left:16px;color:#6b6257;font-size:9.5pt}tr.mode .num{font-weight:400}
.ok{color:#1e4d3c}.due{color:#8f3d16}
.grid tbody tr:nth-child(even) td{background:#faf7f1}
section{margin-bottom:16px;break-inside:avoid}
.book{display:flex;gap:24px;border:1px solid #e4dccd;border-radius:8px;padding:10px 12px;background:#faf7f1}
.book b{font-family:Georgia,serif;font-size:13pt}
.empty{color:#6b6257;font-style:italic}
footer{margin-top:18px;padding-top:8px;border-top:1px solid #e4dccd;font-size:8.5pt;color:#6b6257;display:flex;justify-content:space-between}
</style></head><body>
<header><div class="brand">${yard.logo ? `<img src="${esc(yard.logo)}" alt="">` : ""}<div><div class="name">${esc(yard.name)}</div><div class="addr">${esc([yard.address, yard.phone].filter(Boolean).join(" · "))}</div></div></div>
<div class="title"><div class="t">Day summary</div><div class="d">${esc(dmy(day))}${day === today ? " (so far)" : ""}</div></div></header>
<div class="kpis">${kpi("Given", String(total(s.given)))}${kpi("Taken back", String(total(s.back)), "ok")}${kpi("Collected", money(s.collected), "ok")}${kpi("Change in dues", signed(s.duesChange), s.duesChange > 0 ? "due" : s.duesChange < 0 ? "ok" : "")}</div>
<div class="cols"><section><h2>Cylinders</h2><table>${cyl}</table></section><section><h2>Money</h2><table>${cash}</table></section></div>
<section>${people}</section>
<section><h2>Whole book now</h2><div class="book"><div>To collect<br><b class="due">${esc(money(s.toCollect))}</b></div><div>Cylinders with customers<br><b>${s.cylindersOut}</b></div></div></section>
<footer><span>Printed ${esc(printed)}</span><span>Cxyledge</span></footer>
</body></html>`;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const go = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 60_000);
    };
    const img = doc.querySelector("img");
    if (img && !img.complete) img.addEventListener("load", go, { once: true });
    else window.setTimeout(go, 150);
  };

  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHead
        title="Day summary"
        detail={day === today ? "Today so far" : dmy(day)}
        action={
          <div className="flex items-center gap-1 no-print">
            <button type="button" className="btn btn-ghost size-10 min-h-0 p-0" aria-label="Day before" onClick={() => setDay(addDays(day, -1))}>
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <input type="date" className="field h-10 w-[9.5rem] py-0" value={day} max={today} aria-label="Day" onChange={(event) => event.target.value && setDay(event.target.value)} />
            <button type="button" className="btn btn-ghost size-10 min-h-0 p-0" aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        }
      />

      <Tally
        items={[
          { label: "Given", value: total(s.given) },
          { label: "Taken back", value: total(s.back), tone: "pine" },
          { label: "Collected", value: money(s.collected), tone: "pine" },
          { label: "Dues change", value: signed(s.duesChange), tone: s.duesChange > 0 ? "rust" : s.duesChange < 0 ? "pine" : undefined },
        ]}
      />

      {!s.lines ? <p className="card px-4 py-6 text-center text-sm text-muted">Nothing recorded on {dmy(day)}.</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Cylinders">
          <dl className="divide-y divide-line text-sm">
            <Row label="Given to customers" value={total(s.given)} detail={typeLine(s.given)} />
            <Row label="Taken back" value={total(s.back)} detail={typeLine(s.back)} />
            <Row label="Sent to plant" value={total(s.toPlant)} detail={typeLine(s.toPlant)} />
            <Row label="Back full from plant" value={total(s.fromPlant)} detail={typeLine(s.fromPlant)} />
            {total(s.bought) ? <Row label="Bought" value={total(s.bought)} detail={typeLine(s.bought)} /> : null}
          </dl>
        </Panel>
        <Panel title="Money">
          <dl className="divide-y divide-line text-sm">
            <Row label="Bills made" value={money(s.billed)} />
            <Row label="Collected" value={money(s.collected)} tone="pine" />
            {[...s.modes].map(([mode, amount]) => (
              <div key={mode} className="flex justify-between gap-3 py-1.5 pl-4 text-muted">
                <dt>{MODE_WORD[mode] ?? mode}</dt>
                <dd className="tabular-nums">{money(amount)}</dd>
              </div>
            ))}
            <Row label="Paid to suppliers" value={money(s.paidOut)} />
            <Row label="Change in dues" detail={s.duesChange > 0 ? "Billed more than collected" : s.duesChange < 0 ? "More money came in than was billed" : undefined} value={signed(s.duesChange)} tone={s.duesChange > 0 ? "rust" : s.duesChange < 0 ? "pine" : undefined} />
          </dl>
        </Panel>
      </div>

      {s.customers.length ? (
        <Panel title="By customer">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label border-b border-line text-left">
                  <th className="py-2 pr-2 font-semibold">Company</th>
                  <th className="px-2 py-2 text-right font-semibold">Given</th>
                  <th className="px-2 py-2 text-right font-semibold">Returned</th>
                  <th className="px-2 py-2 text-right font-semibold">Billed</th>
                  <th className="py-2 pl-2 text-right font-semibold">Paid</th>
                </tr>
              </thead>
              <tbody>
                {s.customers.map((row) => (
                  <tr key={row.name} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-2 font-medium">{row.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.given || ""}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.back || ""}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.billed ? money(row.billed) : ""}</td>
                    <td className="py-2 pl-2 text-right tabular-nums text-pine">{row.paid ? money(row.paid) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="Whole book now">
        <p className="text-sm">
          <span className="font-semibold text-rust">{money(s.toCollect)}</span> to collect · <span className="font-semibold">{s.cylindersOut}</span> cylinders with customers
        </p>
      </Panel>

      <div className="flex flex-wrap gap-2 no-print">
        <a className="btn btn-pine gap-1.5" href={whatsappLink("", message)} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="size-4" aria-hidden /> Send on WhatsApp
        </a>
        <button type="button" className="btn btn-ghost gap-1.5" onClick={copy}>
          <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy text"}
        </button>
        <button type="button" className="btn btn-ghost gap-1.5" onClick={() => printReport()}>
          <Printer className="size-4" aria-hidden /> Print
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, detail, tone }: { label: string; value: string | number; detail?: string; tone?: "pine" | "rust" }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="min-w-0">
        <span className="block">{label}</span>
        {detail ? <span className="block text-xs text-muted">{detail}</span> : null}
      </dt>
      <dd className={cn("shrink-0 font-semibold tabular-nums", !value && "font-normal text-muted", tone === "pine" && "text-pine", tone === "rust" && "text-rust")}>{value || "0"}</dd>
    </div>
  );
}
