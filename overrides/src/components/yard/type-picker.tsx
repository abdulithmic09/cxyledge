import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Cylinder type as tap-to-pick buttons. Replaces the browser's suggestion dropdown,
 * which jumps and flickers on phones. Tapping the selected type again clears it.
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
  const known = types.some((type) => type.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(false);
  const showOther = typing || (Boolean(value.trim()) && !known);

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {types.map((type) => {
          const on = type.toLowerCase() === value.trim().toLowerCase();
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={on}
              className={cn("btn h-10 px-3 text-sm", on ? "btn-pine" : "btn-ghost")}
              onClick={() => {
                setTyping(false);
                onChange(on ? "" : type);
              }}
            >
              {type}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={showOther}
          className={cn("btn h-10 px-3 text-sm", showOther ? "btn-pine" : "btn-ghost")}
          onClick={() => {
            if (showOther) {
              setTyping(false);
              onChange("");
            } else {
              setTyping(true);
              onChange("");
            }
          }}
        >
          Other…
        </button>
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
      <p className="mt-1 text-xs text-muted">Add or remove types in Settings → Cylinder types.</p>
    </fieldset>
  );
}
