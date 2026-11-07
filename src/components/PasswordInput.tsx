"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** A password field with Show / Hide (E-SHL-09). The toggle is type="button", so it never submits the form. */
export function PasswordInput({
  label, name, autoComplete, minLength, required = true,
}: {
  label: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          name={name}
          type={shown ? "text" : "password"}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className="flex-1 min-w-0 border border-[var(--line-2)] rounded-lg p-2 text-sm"
          data-password-input={name}
        />
        <button
          type="button"
          className="btn sm shrink-0"
          aria-pressed={shown}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setShown((v) => !v)}
          data-password-toggle={name}
        >
          {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {shown ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
