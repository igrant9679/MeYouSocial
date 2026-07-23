"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

// Submit button that reflects the pending state of its enclosing <form action={...}>.
// Disables + shows a spinner while the server action runs, preventing double-submits
// and giving the user feedback. Must be rendered inside the <form> it submits.
export function SubmitButton({
  children,
  className = "btn primary",
  pendingText,
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      // Disable while the action runs OR when the caller disables it — merged so
      // a passed `disabled={false}` can't re-enable a pending button.
      disabled={pending || Boolean(disabled)}
      aria-busy={pending}
      className={className}
      {...rest}
    >
      {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
      {pending ? pendingText ?? children : children}
    </button>
  );
}
