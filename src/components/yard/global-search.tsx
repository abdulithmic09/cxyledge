import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Cylinder, LayoutList, Receipt, Search, X } from "lucide-react";
import { listCompanyMeta, type Entry, type Payment } from "@/lib/inventory/api";
import { companyBalances } from "@/lib/inventory/analyse";
import { getTracking } from "@/lib/inventory/tracking";
import { cylinderIndex, cylinderStatus, WHERE_LABEL } from "@/lib/inventory/stock";
import { formatDay } from "@/lib/inventory/model";
import { rupee, splitSerials } from "@/lib/inventory/serials";
import { groupBills } from "@/components/yard/bill-views";

type Props = {
  entries: Entry[];
  payments: Payment[];
  onOpenCompany: (company: string) => void;
  onOpenEntry: (id: string) => void;
  onOpenBill: (billNo: string) => void;
  onFindCylinder: (serial: string) => void;
};

const WORD: Record<string, string> = { delivery: "Given", return: "Returned", purchase: "Bought" };

/** One search box for the whole book: customers, cylinders, bills and book lines. */
export function GlobalSearch(props: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement))) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" className="grid size-11 place-items-center rounded-lg border border-line bg-card hover:bg-sand" aria-label="Search the whole book" onClick={() => setOpen(true)}>
        <Search className="size-5" aria-hidden />
      </button>
      {open ? <SearchSheet {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SearchSheet({ entries, payments, onOpenCompany, onOpenEntry, onOpenBill, onFindCylinder, onClose }: Props & { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });
  const tracking = useQuery({ queryKey: ["tracking"], queryFn: () => getTracking() });
  const balances = useMemo(() => companyBalances(entries, payments), [entries, payments]);
  const bills = useMemo(() => groupBills(entries), [entries]);
  const cylinders = useMemo(() => cylinderIndex(entries, tracking.data?.moves ?? []), [entries, tracking.data]);

  useEffect(() => {
    input.current?.focus();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 2) return null;
    const meta = new Map((metaQuery.data ?? []).map((row) => [row.companyName, row]));
    const customers = balances
      .filter((row) => {
        const m = meta.get(row.company);
        return `${row.company} ${m?.phone ?? ""} ${m?.keywords ?? ""} ${m?.notes ?? ""}`.toLowerCase().includes(q);
      })
      .slice(0, 5);
    const cyl = [...cylinders.entries()]
      .filter(([key]) => key.includes(q))
      .slice(0, 5)
      .map(([, item]) => ({ serial: item.serial, status: cylinderStatus(item.serial, item.events) }));
    const billHits = bills.filter((bill) => bill.billNo.toLowerCase().includes(q)).slice(0, 5);
    const lines = entries
      .filter((entry) => [entry.companyName, entry.serialNo, entry.billNo, entry.note, entry.cylinderType].join(" ").toLowerCase().includes(q))
      .slice(0, 6);
    return { customers, cyl, billHits, lines };
  }, [q, balances, cylinders, bills, entries, metaQuery.data]);

  const nothing = results && !results.customers.length && !results.cyl.length && !results.billHits.length && !results.lines.length;
  const go = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex lg:items-start lg:justify-center lg:bg-ink/40 lg:p-6 lg:pt-20" role="dialog" aria-modal="true" aria-label="Search">
      <div className="flex h-full w-full flex-col bg-paper lg:h-auto lg:max-h-[80vh] lg:max-w-xl lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line bg-card px-3 py-2">
          <Search className="size-5 shrink-0 text-muted" aria-hidden />
          <input
            ref={input}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company, serial no., bill no., phone…"
            aria-label="Search"
          />
          <button type="button" className="grid size-11 place-items-center rounded-lg hover:bg-sand" aria-label="Close search" onClick={onClose}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {!results ? <p className="px-3 text-sm text-muted">Type at least 2 letters. Searches customers, cylinders, bills and every book line.</p> : null}
          {nothing ? <p className="px-3 text-sm text-muted">Nothing found for “{query.trim()}”.</p> : null}
          {results?.customers.length ? (
            <Group title="Customers">
              {results.customers.map((row) => (
                <Row key={row.company} icon={Building2} title={row.company} detail={`${row.outstandingQty} out · ${rupee(row.toCollect, 0)} due`} onClick={() => go(() => onOpenCompany(row.company))} />
              ))}
            </Group>
          ) : null}
          {results?.cyl.length ? (
            <Group title="Cylinders">
              {results.cyl.map((item) => (
                <Row
                  key={item.serial}
                  icon={Cylinder}
                  title={item.serial}
                  detail={item.status ? `${WHERE_LABEL[item.status.where]}${item.status.where === "customer" && item.status.party ? `: ${item.status.party}` : ""} · ${item.status.type}` : "No history"}
                  onClick={() => go(() => onFindCylinder(item.serial))}
                />
              ))}
            </Group>
          ) : null}
          {results?.billHits.length ? (
            <Group title="Bills">
              {results.billHits.map((bill) => (
                <Row key={bill.billNo} icon={Receipt} title={bill.billNo} detail={`${bill.company} · ${formatDay(bill.date)}${bill.total != null ? ` · ${rupee(bill.total, 0)}` : ""}`} onClick={() => go(() => onOpenBill(bill.billNo))} />
              ))}
            </Group>
          ) : null}
          {results?.lines.length ? (
            <Group title="Book lines">
              {results.lines.map((entry) => (
                <Row
                  key={entry.id}
                  icon={LayoutList}
                  title={`${entry.companyName} · ${WORD[entry.movement] ?? entry.movement} ${entry.quantity}`}
                  detail={`${formatDay(entry.entryDate)}${entry.cylinderType ? ` · ${entry.cylinderType}` : ""}${entry.serialNo ? ` · ${splitSerials(entry.serialNo).slice(0, 4).join(", ")}` : ""}`}
                  onClick={() => go(() => onOpenEntry(entry.id))}
                />
              ))}
            </Group>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function Row({ icon: Icon, title, detail, onClick }: { icon: typeof Search; title: string; detail: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-sand" onClick={onClick}>
        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-muted">{detail}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
    </li>
  );
}
