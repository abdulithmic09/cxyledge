import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { saveCylinderTypes, type YardInfo } from "@/lib/inventory/api";
import { DEFAULT_CYLINDER_TYPES } from "@/lib/inventory/serials";
import { useRole } from "@/lib/inventory/role";
import { Panel } from "@/components/yard/ui";

/** The book's cylinder types: shared by everyone in the book, edited by the owner. */
export function TypesPanel({ yard, onChanged }: { yard: YardInfo; onChanged: () => void }) {
  const { isOwner } = useRole();
  const [types, setTypes] = useState<string[]>(yard.cylinderTypes);
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    setTypes(yard.cylinderTypes);
  }, [yard.cylinderTypes]);

  async function save(next: string[], message: string) {
    const before = types;
    setTypes(next);
    setBusy(true);
    setNote(null);
    try {
      const result = await saveCylinderTypes({ data: next });
      if (!result.ok) {
        setTypes(before);
        setNote({ tone: "bad", text: result.error });
        return;
      }
      setTypes(result.types);
      setNote({ tone: "ok", text: message });
      onChanged();
    } catch {
      setTypes(before);
      setNote({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const name = fresh.trim().slice(0, 60);
    if (!name) return;
    if (types.some((type) => type.toLowerCase() === name.toLowerCase())) {
      setNote({ tone: "bad", text: `${name} is already in the list.` });
      return;
    }
    setFresh("");
    void save([...types, name], `Added ${name}.`);
  }

  const isDefault = types.length === DEFAULT_CYLINDER_TYPES.length && types.every((type, index) => type === DEFAULT_CYLINDER_TYPES[index]);

  return (
    <Panel title="Cylinder types">
      <p className="text-sm text-muted">
        These are the buttons you pick from when booking an entry or making a bill. Everyone in this book sees the same list. Removing a type doesn&apos;t change old entries.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {types.map((type) => (
          <li key={type} className="flex h-10 items-center gap-1 rounded-lg border border-line bg-paper pl-3 pr-1 text-sm">
            {type}
            {isOwner ? (
              <button
                type="button"
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-sand hover:text-rust"
                aria-label={`Remove ${type}`}
                disabled={busy || types.length <= 1}
                onClick={() => void save(types.filter((item) => item !== type), `Removed ${type}.`)}
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
        <>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input
              className="field flex-1"
              value={fresh}
              maxLength={60}
              onChange={(event) => setFresh(event.target.value)}
              placeholder="New type, e.g. B-Type Helium"
              aria-label="New cylinder type"
            />
            <button type="submit" className="btn btn-pine" disabled={busy || !fresh.trim()}>
              Add type
            </button>
          </form>
          {!isDefault ? (
            <button type="button" className="btn btn-ghost mt-2" disabled={busy} onClick={() => void save([...DEFAULT_CYLINDER_TYPES], "Standard list restored.")}>
              Restore the standard list
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">Only the owner can change this list.</p>
      )}
      {note ? (
        <p className={note.tone === "ok" ? "mt-2 text-sm text-pine" : "mt-2 text-sm text-rust"} role="status">
          {note.text}
        </p>
      ) : null}
    </Panel>
  );
}
