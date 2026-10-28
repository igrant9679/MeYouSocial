"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings } from "lucide-react";

/**
 * Who you are, in one place (E-SHL-04): the header carried a role badge and the
 * email address beside the bell, every page, at every width that fit them. They
 * live behind the avatar now, with your settings (theme, text size) and Sign out.
 */
export function AccountMenu({
  initials,
  name,
  email,
  role,
  workspaceName,
  signOutAction,
}: {
  initials: string;
  name: string;
  email: string;
  role: string;
  workspaceName: string;
  signOutAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  // A navigation closes it (the header outlives the page).
  if (shownFor !== pathname) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  const roleWord = role.charAt(0) + role.slice(1).toLowerCase();
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Your account — ${email}, ${roleWord}`}
        title={`${email} · ${roleWord}`}
        className="w-9 h-9 rounded-full grid place-items-center font-mono font-bold text-[12px] uppercase"
        style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}
      >
        {initials}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 w-64 max-w-[90vw] card z-50 shadow-xl">
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-xs text-[var(--mute)] truncate">{email}</div>
          <div className="text-xs mt-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>{roleWord}</span>
            <span className="text-[var(--mute)]"> in {workspaceName}</span>
          </div>
          <div className="border-t border-[var(--line)] mt-2.5 pt-2 flex flex-col gap-0.5">
            <Link href="/settings" role="menuitem" className="flex items-center gap-2 text-sm px-1.5 py-1.5 rounded-lg hover:bg-[var(--zebra)]" onClick={() => setOpen(false)}>
              <Settings className="w-4 h-4" /> Your settings <span className="text-[var(--mute)] text-xs">theme, text size</span>
            </Link>
            <form action={signOutAction}>
              <button role="menuitem" className="w-full flex items-center gap-2 text-sm px-1.5 py-1.5 rounded-lg hover:bg-[var(--zebra)] text-left">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
