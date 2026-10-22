import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { saveCylinderTypes, type YardInfo } from "@/lib/inventory/api";
import { buildTypes, cleanGas, cleanSize, DEFAULT_GASES, DEFAULT_SIZES, groupTypes, isStandard, MAX_PAIRS } from "@/lib/inventory/gases";
import { useRole } from "@/lib/inventory/role";
import { Panel } from "@/components/yard/ui";

type Note = { tone: "ok" | "bad"; text: string } | null;

/** The book's gases and cylinder sizes: shared by everyone in the book, edited by the owner. */
export function TypesPanel({ yard, onChanged }: { yard: YardInfo; onChanged: () => void }) {
  const { isOwner } = useRole();
  const grouped = useMemo(() => groupTypes(yard.cylinderTypes), [yard.cylinderTypes]);
  const [gases, setGases] = useState(grouped.gases);
  const [sizes, setSizes] = useState(grouped.sizes);
  const [freshGas, setFreshGas] = useState("");
  const [freshSize, setFreshSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    setGases(grouped.gases);
    setSizes(grouped.sizes);
  }, [grouped]);

  async function save(nextGases: string[], nextSizes: string[], message: string) {
    if (nextGases.length * nextSizes.length > MAX_PAIRS) {
      setNote({ tone: "bad", text: `That makes more than ${MAX_PAIRS} gas and size pairs. Remove a gas or a size first.` });
      return;
    }
    const before = { gases, sizes };
    setGases(nextGases);
    setSizes(nextSizes);
    setBusy(true);
    setNote(null);
    try {
      const result = await saveCylinderTypes({ data: buildTypes(nextGases, nextSizes) });
      if (!result.ok) {
        setGases(before.gases);
        setSizes(before.sizes);
        setNote({ tone: "bad", text: result.error });
        return;
      }
      setNote({ tone: "ok", text: message });
      onChanged();
    } catch {
      setGases(before.gases);
      setSizes(before.sizes);
      setNote({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  function addGas() {
    const name = cleanGas(freshGas);
    if (!name) return;
    if (gases.some((gas) => gas.toLowerCase() === name.toLowerCase())) {
      setNote({ tone: "bad", text: `${name} is already in the list.` });
      return;
    }
    setFreshGas("");
    void save([...gases, name], sizes, `Added ${name}.`);
  }

  function addSize() {
    const name = cleanSize(freshSize);
    if (!name) return;
    if (sizes.some((size) => size.toLowerCase() === name.toLowerCase())) {
      setNote({ tone: "bad", text: `${name} is already in the list.` });
      return;
    }
    setFreshSize("");
    const next = [...sizes, name].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    void save(gases, next, `Added ${name}.`);
  }

  return (
    <Panel title="Gas types">
      <p className="text-sm text-muted">
        When booking an entry or making a bill you pick a gas, then its cylinder size, e.g. Oxygen ▸ B-Type. Every gas comes in every size listed here. Everyone in this book sees the same lists, and removing one doesn&apos;t change old entries.
      </p>

      <Group
        title="Gases"
        items={gases}
        isOwner={isOwner}
        busy={busy}
        onRemove={(gas) => void save(gases.filter((item) => item !== gas), sizes, `Removed ${gas}.`)}
        value={freshGas}
        onValue={setFreshGas}
        onAdd={addGas}
        placeholder="New gas, e.g. Helium"
        addLabel="Add gas"
      />
      <Group
        title="Cylinder sizes"
        items={sizes}
        isOwner={isOwner}
        busy={busy}
        onRemove={(size) => void save(gases, sizes.filter((item) => item !== size), `Removed ${size}.`)}
        value={freshSize}
        onValue={setFreshSize}
        onAdd={addSize}
        placeholder="New size, e.g. C"
        addLabel="Add size"
      />

      {isOwner && !isStandard(gases, sizes) ? (
        <button type="button" className="btn btn-ghost mt-4" disabled={busy} onClick={() => void save([...DEFAULT_GASES], [...DEFAULT_SIZES], "Standard lists restored.")}>
          Restore the standard lists
        </button>
      ) : null}
      {!isOwner ? <p className="mt-3 text-sm text-muted">Only the owner can change these lists.</p> : null}
      {note ? (
        <p className={note.tone === "ok" ? "mt-2 text-sm text-pine" : "mt-2 text-sm text-rust"} role="status">
          {note.text}
        </p>
      ) : null}
    </Panel>
  );
}

function Group({
  title,
  items,
  isOwner,
  busy,
  onRemove,
  value,
  onValue,
  onAdd,
  placeholder,
  addLabel,
}: {
  title: string;
  items: string[];
  isOwner: boolean;
  busy: boolean;
  onRemove: (item: string) => void;
  value: string;
  onValue: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <section className="mt-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item} className="flex h-10 items-center gap-1 rounded-lg border border-line bg-paper pl-3 pr-1 text-sm">
            {item}
            {isOwner ? (
              <button
                type="button"
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-sand hover:text-rust"
                aria-label={`Remove ${item}`}
                disabled={busy || items.length <= 1}
                onClick={() => onRemove(item)}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : (
              <span className="w-2" />
            )}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd();
          }}
        >
          <input className="field sm:flex-1" value={value} maxLength={36} onChange={(event) => onValue(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
          <button type="submit" className="btn btn-pine" disabled={busy || !value.trim()}>
            {addLabel}
          </button>
        </form>
      ) : null}
    </section>
  );
}
