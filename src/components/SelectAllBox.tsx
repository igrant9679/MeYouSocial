"use client";

import { useState } from "react";

/**
 * "Select all on this page" for a bulk form (E-ART-08): ticks or clears every
 * `name` checkbox in the same form — or, with `formId`, every one tied to that
 * form by its `form` attribute (boxes spread over several tables, E-IDE-13).
 * The checkboxes and the actions are plain form fields — this is the only part
 * that needs the browser.
 */
export function SelectAllBox({ name = "ids", label = "Select all on this page", formId }: { name?: string; label?: string; formId?: string }) {
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
          const boxes = formId
            ? document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"][form="${formId}"]`)
            : e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`);
          boxes?.forEach((box) => { box.checked = next; });
        }}
      />
      {label}
    </label>
  );
}
