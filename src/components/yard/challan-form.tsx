import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eraser, Plus, Trash2 } from "lucide-react";
import type { Entry, YardInfo } from "@/lib/inventory/api";
import { billPrefix, nextNumber, saveBill } from "@/lib/inventory/billing";
import { saveChallan } from "@/lib/inventory/tracking";
import { splitSerials } from "@/lib/inventory/serials";
import { blobToDataUrl, makeBillPdf, pdfName, type BillData } from "@/lib/inventory/bill-pdf";
import { downloadBlob, shareBlob } from "@/lib/inventory/files";
import { todayISO } from "@/lib/inventory/model";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { TypePicker } from "@/components/yard/type-picker";
import { Field, Panel } from "@/components/yard/ui";

type Line = { key: string; type: string; serials: string; own: boolean; qty: number };

let seq = 0;
const blank = (): Line => ({ key: `c${(seq += 1)}`, type: "", serials: "", own: false, qty: 0 });
const qtyOf = (line: Line) => (line.own ? line.qty : splitSerials(line.serials).length);

/** A finger or mouse signature box. Gives back a PNG data URL, or "" when cleared. */
export function SignaturePad({ value, onChange }: { value: string; onChange: (png: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    el.width = el.clientWidth * ratio;
    el.height = el.clientHeight * ratio;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c1915";
    if (!value) ctx.clearRect(0, 0, el.width, el.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === ""]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-dashed border-line bg-white">
        <canvas
          ref={canvas}
          className="block h-36 w-full touch-none"
          aria-label="Signature box. Sign with your finger or mouse."
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = true;
            last.current = point(event);
          }}
          onPointerMove={(event) => {
            if (!drawing.current || !last.current) return;
            const ctx = event.currentTarget.getContext("2d");
            const next = point(event);
            if (ctx) {
              ctx.beginPath();
              ctx.moveTo(last.current.x, last.current.y);
              ctx.lineTo(next.x, next.y);
              ctx.stroke();
            }
            last.current = next;
          }}
          onPointerUp={(event) => {
            if (!drawing.current) return;
            drawing.current = false;
            last.current = null;
            onChange(event.currentTarget.toDataURL("image/png"));
          }}
        />
        {!value ? <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-muted">Receiver signs here</span> : null}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-line" aria-hidden />
      </div>
      <button
        type="button"
        className="btn btn-ghost mt-2 h-9 gap-2 px-3 text-sm"
        onClick={() => {
          const el = canvas.current;
          el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
          onChange("");
        }}
      >
        <Eraser className="size-4" aria-hidden /> Clear signature
      </button>
    </div>
  );
}

/** Delivery challan: goes with the cylinders, signed on the phone, turned into a bill later. */
export function ChallanForm({ yard, entries, onSaved }: { yard: YardInfo; entries: Entry[]; onSaved: () => void }) {
  const { canEdit } = useRole();
  const client = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [company, setCompany] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [blank()]);
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [receiver, setReceiver] = useState("");
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const names = useMemo(() => [...new Set(entries.map((entry) => entry.companyName))].sort(), [entries]);
  const challanNo = nextNumber(entries.map((entry) => entry.billNo), billPrefix(date, "DC"));
  const total = lines.reduce((sum, line) => sum + qtyOf(line), 0);

  const data: BillData = {
    yard,
    kind: "sale",
    billNo: challanNo,
    date,
    company: company.trim() || "Company",
    lines: lines.map((line) => ({ cylinderType: line.type, serials: splitSerials(line.serials), quantity: qtyOf(line), price: null })),
    total: null,
    payment: "unpaid",
    paid: null,
    note,
    challan: { vehicle, driver, receiver, signature },
  };

  const update = (key: string, patch: Partial<Line>) => setLines((all) => all.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  async function save() {
    setStatus(null);
    if (!company.trim()) {
      setStatus({ tone: "bad", text: "Enter the company name." });
      return;
    }
    setBusy(true);
    try {
      const pdf = await makeBillPdf(data);
      const result = await saveBill({
        data: {
          originalBillNo: "",
          kind: "sale",
          billNo: challanNo,
          date,
          company,
          lines: lines.map((line) => ({ cylinderType: line.type, serialNo: line.serials, quantity: qtyOf(line), qtyOverride: line.own, unitPrice: null })),
          total: null,
          payment: "unpaid",
          paid: null,
          note,
          pdf: await blobToDataUrl(pdf),
        },
      });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      const saved = await saveChallan({ data: { challanNo, companyName: company, date, vehicle, driver, receiver, signature } });
      setStatus({
        tone: saved.ok ? "ok" : "bad",
        text: saved.ok
          ? `Challan ${challanNo} saved. The cylinders are on ${company.trim()}'s balance. Turn it into a bill from All bills when you're ready.`
          : `Cylinders saved, but the signature didn't: ${saved.error}`,
      });
      downloadBlob(pdfName(challanNo, company), pdf);
      setLines([blank()]);
      setSignature("");
      setReceiver("");
      setNote("");
      void client.invalidateQueries({ queryKey: ["tracking"] });
      onSaved();
    } catch {
      setStatus({ tone: "bad", text: "Could not save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <Panel title="Delivery challan">
        <p className="text-sm text-muted">View-only access: you can't make challans.</p>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`Delivery challan ${challanNo}`}>
        <div className="grid gap-3">
          <p className="text-sm text-muted">The slip that goes with the cylinders. The cylinders go on the company&apos;s balance now; prices are added when you make the bill.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company">
              <input className="field" value={company} list="challan-companies" onChange={(event) => setCompany(event.target.value)} placeholder="Sharma Stores" />
              <datalist id="challan-companies">
                {names.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field label="Date">
              <input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>
          {lines.map((line, index) => (
            <div key={line.key} className={cn("grid gap-3", lines.length > 1 && "rounded-xl border border-line bg-paper/60 p-3")}>
              {lines.length > 1 ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-rust">Gas {index + 1}</span>
                  <button type="button" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-rust" aria-label={`Remove gas ${index + 1}`} onClick={() => setLines((all) => all.filter((item) => item.key !== line.key))}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ) : null}
              <TypePicker value={line.type} types={yard.cylinderTypes} onChange={(type) => update(line.key, { type })} />
              <Field label="Serial numbers" hint={splitSerials(line.serials).length ? `${splitSerials(line.serials).length} counted` : undefined}>
                <textarea className="field field-area min-h-20" value={line.serials} onChange={(event) => update(line.key, { serials: event.target.value })} />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="size-4 accent-[var(--color-pine)]" checked={line.own} onChange={(event) => update(line.key, { own: event.target.checked, qty: event.target.checked ? qtyOf(line) || 1 : 0 })} />
                Type the quantity myself
                {line.own ? (
                  <input className="field ml-2 h-9 w-24 tabular-nums" inputMode="numeric" value={String(line.qty)} onChange={(event) => update(line.key, { qty: Number(event.target.value.replace(/[^\d]/g, "") || "0") })} aria-label="Quantity" />
                ) : (
                  <span className="ml-auto font-semibold text-ink">{qtyOf(line)} cylinders</span>
                )}
              </label>
            </div>
          ))}
          <button type="button" className="btn btn-soft justify-center gap-2" onClick={() => setLines((all) => [...all, blank()])}>
            <Plus className="size-4" aria-hidden /> Add another gas
          </button>
          <p className="text-sm">
            <span className="font-semibold">{total}</span> cylinders on this challan
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vehicle no.">
              <input className="field uppercase" value={vehicle} maxLength={30} onChange={(event) => setVehicle(event.target.value)} placeholder="MH 14 AB 1234" />
            </Field>
            <Field label="Driver">
              <input className="field" value={driver} maxLength={60} onChange={(event) => setDriver(event.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <input className="field" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </Panel>
      <Panel title="Receiver signs">
        <div className="grid gap-3">
          <Field label="Receiver's name">
            <input className="field" value={receiver} maxLength={60} onChange={(event) => setReceiver(event.target.value)} />
          </Field>
          <SignaturePad value={signature} onChange={setSignature} />
          {status ? (
            <p className={cn("text-sm", status.tone === "ok" ? "text-pine" : "text-rust")} role="status">
              {status.text}
            </p>
          ) : null}
          <button type="button" className="btn btn-rust" disabled={busy || !total} onClick={() => void save()}>
            {busy ? "Saving…" : signature ? "Save signed challan" : "Save challan (sign later on paper)"}
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => void makeBillPdf(data).then((pdf) => downloadBlob(pdfName(challanNo, company), pdf))}>
              Preview PDF
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void makeBillPdf(data).then((pdf) => shareBlob(pdfName(challanNo, company), pdf, `${challanNo} · ${yard.name}`))}>
              Share
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
