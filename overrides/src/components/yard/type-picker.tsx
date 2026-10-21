import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const OTHER = "__other__";

/**
 * Cylinder type as a drop-down list with a smooth open/close animation.
 * Our own list (not the browser's suggestion box, which jumps on phones):
 * it slides open under the field, scrolls inside itself, and closes on
 * pick, outside tap or Escape. Arrow keys and Enter work too.
 */
export function TypePicker({
  value,
  types,
  onChange,
  label = "Cylinder type",
}: {
  value: string;
  types: string[];
  onChange: (value: string) => void;
  label?: string;
}) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);
  const known = types.find((type) => type.toLowerCase() === value.trim().toLowerCase());
  const showOther = typing || (Boolean(value.trim()) && !known);
  const options = [...types, OTHER];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const current = showOther ? options.length - 1 : Math.max(0, types.findIndex((type) => type === known));
    setActive(current);
    // Bring the selected row into view inside the list, without moving the page.
    requestAnimationFrame(() => {
      const row = list.current?.children[current] as HTMLElement | undefined;
      if (row && list.current) list.current.scrollTop = row.offsetTop - list.current.clientHeight / 2 + row.clientHeight / 2;
      // If the list would open under the bottom bar or off-screen, glide the page up just enough.
      const button = trigger.current?.getBoundingClientRect();
      const height = list.current?.offsetHeight ?? 0;
      if (button) {
        const bar = window.matchMedia("(min-width: 1024px)").matches ? 16 : 80;
        const overflow = button.bottom + 6 + height - (window.innerHeight - bar);
        if (overflow > 0) window.scrollBy({ top: Math.min(overflow, button.top - 72), behavior: "smooth" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(option: string) {
    if (option === OTHER) {
      setTyping(true);
      onChange("");
    } else {
      setTyping(false);
      onChange(option);
    }
    setOpen(false);
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const next = Math.min(options.length - 1, Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      (list.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      pick(options[active]!);
    }
  }

  const shown = showOther ? (value.trim() ? value : "Other…") : (known ?? "");

  return (
    <div ref={wrap}>
      <span id={`${id}-label`} className="mb-1.5 block text-sm font-medium">
        {label}
      </span>
      <div className="relative">
      <button
        ref={trigger}
        type="button"
        className="field flex w-full items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKey}
      >
        <span className={cn("truncate", !shown && "text-muted")}>{shown || "Choose a cylinder type"}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>

      <div
        className={cn(
          "absolute inset-x-0 top-full z-40 mt-1 origin-top rounded-xl border border-line bg-card shadow-lg",
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          open ? "pointer-events-auto translate-y-0 scale-y-100 opacity-100" : "pointer-events-none -translate-y-1 scale-y-95 opacity-0",
        )}
        aria-hidden={!open}
      >
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="max-h-64 overflow-y-auto overscroll-contain scroll-smooth py-1"
        >
          {options.map((option, index) => {
            const isOther = option === OTHER;
            const selected = isOther ? showOther : !showOther && option === known;
            return (
              <li
                key={option}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 text-sm transition-colors duration-100",
                  index === active ? "bg-sand" : "",
                  selected ? "font-semibold text-pine" : "",
                  isOther ? "border-t border-line text-muted" : "",
                )}
                onPointerMove={() => active !== index && setActive(index)}
                onClick={() => pick(option)}
              >
                {isOther ? "Other… (type your own)" : option}
                {selected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
              </li>
            );
          })}
        </ul>
      </div>
      </div>

      {showOther ? (
        <input
          className="field mt-2"
          value={known ? "" : value}
          maxLength={60}
          autoFocus={typing}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type the cylinder type"
          aria-label="Other cylinder type"
        />
      ) : null}
      <span className="mt-1 block text-xs text-muted">Add or remove types in Settings → Cylinder types.</span>
    </div>
  );
}
