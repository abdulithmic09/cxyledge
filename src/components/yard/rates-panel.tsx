import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { saveCompanyPrices } from "@/lib/inventory/billing";
import { groupTypes, joinType } from "@/lib/inventory/gases";
import { useRole } from "@/lib/inventory/role";
import { Panel } from "@/components/yard/ui";

/** A company's rate card: price per cylinder for each gas and size. Bills fill these in by themselves. */
export function RatesPanel({ company, types, prices }: { company: string; types: string[]; prices: Record<string, number> }) {
  const { canEdit } = useRole();
  const client = useQueryClient();
  const { gases, sizes } = useMemo(() => groupTypes(types), [types]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [type, value] of Object.entries(prices)) next[type.toLowerCase()] = String(value);
    setDraft(next);
  }, [company, prices]);

  useEffect(() => setNote(null), [company]);

  const dirty = useMemo(() => {
    const saved = Object.fromEntries(Object.entries(prices).map(([type, value]) => [type.toLowerCase(), String(value)]));
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    return [...keys].some((key) => (saved[key] ?? "") !== (draft[key] ?? "").trim());
  }, [draft, prices]);

  async function save() {
    setBusy(true);
    setNote(null);
    const out: Record<string, number> = {};
    const grid = new Set(gases.flatMap((gas) => sizes.map((size) => joinType(size, gas).toLowerCase())));
    // Keep rates for gas types no longer in the book's list, so nothing is lost.
    for (const [type, value] of Object.entries(prices)) if (!grid.has(type.toLowerCase())) out[type] = value;
    for (const gas of gases)
      for (const size of sizes) {
        const type = joinType(size, gas);
        const raw = (draft[type.toLowerCase()] ?? "").replace(/[^\d.]/g, "");
        if (raw && Number.isFinite(Number(raw))) out[type] = Number(raw);
      }
    try {
      const result = await saveCompanyPrices({ data: { companyName: company, prices: out } });
      if (!result.ok) {
        setNote({ tone: "bad", text: result.error });
        return;
      }
      await client.invalidateQueries({ queryKey: ["company-meta"] });
      setNote({ tone: "ok", text: `Rates saved. New bills for ${company} fill these prices in.` });
    } catch {
      setNote({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  const count = Object.keys(prices).length;

  return (
    <Panel title="Rates">
      <p className="text-sm text-muted">
        Price per cylinder for {company}. {count ? `${count} saved.` : "None saved yet."} Leave a box empty if you don&apos;t sell that size here; bills then use the last price you charged.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="w-[28%] py-1 pr-2 font-semibold">Gas</th>
              {sizes.map((size) => (
                <th key={size} className="px-1 py-1 text-center font-semibold">
                  {size}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gases.map((gas) => (
              <tr key={gas}>
                <th scope="row" className="pr-2 text-left font-medium">
                  {gas}
                </th>
                {sizes.map((size) => {
                  const type = joinType(size, gas);
                  return (
                    <td key={size} className="px-1">
                      <label className="block">
                        <input
                          className="field h-10 w-full min-w-0 px-2 text-right tabular-nums"
                          size={6}
                          inputMode="decimal"
                          disabled={!canEdit}
                          value={draft[type.toLowerCase()] ?? ""}
                          onChange={(event) => setDraft((all) => ({ ...all, [type.toLowerCase()]: event.target.value.replace(/[^\d.]/g, "") }))}
                          aria-label={`${type} rate`}
                          placeholder="₹ —"
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <button type="button" className="btn btn-pine mt-3" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save rates"}
        </button>
      ) : null}
      {note ? (
        <p className={note.tone === "ok" ? "mt-2 text-sm text-pine" : "mt-2 text-sm text-rust"} role="status">
          {note.text}
        </p>
      ) : null}
    </Panel>
  );
}
