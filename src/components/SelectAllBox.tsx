"use client";

import { useState } from "react";

/**
 * "Select all on this page" for a bulk form (E-ART-08): ticks or clears every
 * `name` checkbox in the same form. The checkboxes and the actions are plain
 * form fields — this is the only part that needs the browser.
 */
export function SelectAllBox({ name = "ids", label = "Select all on this page" }: { name?: string; label?: string }) {
  const [on, setOn] = useState(false);
  return (
    <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
      <input
        type="checkbox"
        checked={on}
        aria-label={label}
        data-select-all
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((box) => { box.checked = next; });
        }}
      />
      {label}
    </label>
  );
}
