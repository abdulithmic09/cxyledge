import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Keyboard, X } from "lucide-react";
import { openEntrySheet, type Mode } from "@/components/yard/entry-launcher";

export type ShortcutView = "book" | "customers" | "bills" | "stock" | "day";

const ENTRY_KEYS: Record<string, Mode | "new"> = { n: "new", g: "give", t: "take", e: "exchange", m: "money", b: "bought" };
const VIEW_KEYS: Record<string, ShortcutView> = { "1": "book", "2": "customers", "3": "bills", "4": "stock", "5": "day" };

const LIST: Array<{ keys: string; what: string }> = [
  { keys: "N", what: "New entry" },
  { keys: "G", what: "Give cylinders" },
  { keys: "T", what: "Take back" },
  { keys: "E", what: "Exchange (empties in, fulls out)" },
  { keys: "M", what: "Money received" },
  { keys: "B", what: "Bought stock" },
  { keys: "/", what: "Search everything" },
  { keys: "1", what: "Book" },
  { keys: "2", what: "Customers" },
  { keys: "3", what: "Bills" },
  { keys: "4", what: "Stock" },
  { keys: "5", what: "Day summary" },
  { keys: "Esc", what: "Close a form" },
  { keys: "?", what: "Show this list" },
];

/** True when a key press belongs to a text box or an open form, so shortcuts stay out of the way. */
function typing(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Single-key shortcuts for a computer keyboard. Ignored while typing or while a form is open. */
export function KeyboardShortcuts({ onGo }: { onGo: (view: ShortcutView) => void }) {
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "?") {
        event.preventDefault();
        setHelp((open) => !open);
        return;
      }
      if (document.querySelector('[role=dialog][aria-modal="true"]')) return;
      const entry = ENTRY_KEYS[key];
      if (entry) {
        event.preventDefault();
        openEntrySheet(entry === "new" ? {} : { mode: entry });
        return;
      }
      const view = VIEW_KEYS[key];
      if (view) {
        event.preventDefault();
        onGo(view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onGo]);

  useEffect(() => {
    if (!help) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  return (
    <>
      <button
        type="button"
        className="mt-4 hidden items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-muted hover:bg-card/70 hover:text-ink lg:flex"
        onClick={() => setHelp(true)}
      >
        <Keyboard className="size-4" aria-hidden />
        Shortcuts
        <kbd className="code ml-auto rounded-md border border-line bg-card px-1.5 text-[0.7rem]">?</kbd>
      </button>
      {help
        ? createPortal(
            <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)}>
              <div className="card w-full max-w-md p-5" onClick={(event) => event.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-display text-xl">Keyboard shortcuts</h2>
                  <button type="button" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink" aria-label="Close" onClick={() => setHelp(false)}>
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                <p className="mb-3 text-sm text-muted">Press a key anywhere in the app. They don&apos;t work while you&apos;re typing in a box.</p>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                  {LIST.map((item) => (
                    <li key={item.keys} className="flex items-center gap-3">
                      <kbd className="code grid h-7 min-w-9 place-items-center rounded-md border border-line bg-sand px-1.5 text-xs font-semibold text-ink">{item.keys}</kbd>
                      <span>{item.what}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
