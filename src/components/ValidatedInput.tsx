"use client";

import { useId, useState } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  /** Override the browser's default validity message. */
  errorMessage?: string;
  labelClassName?: string;
};

// Input with inline, per-field validation. Validates on blur (so we don't nag
// mid-typing) and re-validates on input once the field has been touched. Uses the
// browser's native constraint validation (required / type / minLength / pattern),
// with an optional custom message. The submit still goes to the server action.
export function ValidatedInput({ label, errorMessage, className = "", labelClassName, ...props }: Props) {
  const [msg, setMsg] = useState("");
  const [touched, setTouched] = useState(false);
  const id = useId();
  const errId = `${id}-err`;

  function check(el: HTMLInputElement) {
    setMsg(el.checkValidity() ? "" : errorMessage ?? el.validationMessage);
  }
  const showError = touched && !!msg;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className={labelClassName ?? "text-xs font-mono uppercase text-[var(--mute)]"}>
          {label}
          {props.required && <span aria-hidden className="text-[var(--rose)]"> *</span>}
        </label>
      )}
      <input
        {...props}
        id={id}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? errId : undefined}
        onBlur={(e) => { setTouched(true); check(e.currentTarget); props.onBlur?.(e); }}
        onInput={(e) => { if (touched) check(e.currentTarget); props.onInput?.(e); }}
        className={className + (showError ? " !border-[var(--rose)]" : "")}
      />
      {showError && (
        <span id={errId} role="alert" className="text-2xs text-[var(--rose)]">{msg}</span>
      )}
    </div>
  );
}
