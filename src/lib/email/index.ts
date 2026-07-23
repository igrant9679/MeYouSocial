import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { getSmtpConfig } from "./config";

// Email interface. Used for invitations, verifications, password resets,
// and Agent Mode completion notices.
//
// Routing:
//   1. SMTP config stored in DB (admin sets via /admin/email) — preferred.
//   2. SMTP env vars (legacy / fallback).
//   3. Mock — logs to console.
// Any send-time failure logs the error and falls back to mock so the app
// never crashes from a misconfigured outbound mail server.

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ id: string; mocked?: boolean }>;
}

const mock: EmailProvider = {
  async send(message) {
    const id = "mock-" + Math.random().toString(36).slice(2, 10);
    // eslint-disable-next-line no-console
    console.log("📧 [mock email]", id, "→", message.to, "\n  subject:", message.subject);
    return { id, mocked: true };
  },
};

async function buildSmtpTransport(workspaceId?: string) {
  // Prefer the workspace's own config, then the platform's DB config.
  const cfg = await getSmtpConfig(workspaceId);
  if (cfg) {
    return {
      transport: nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      }),
      from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
      source: "db" as const,
    };
  }
  // Env-var fallback.
  const host = process.env.SMTP_HOST;
  if (host) {
    return {
      transport: nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      }),
      from: env.EMAIL_FROM,
      source: "env" as const,
    };
  }
  return null;
}

/**
 * Multi-tenant sender: a workspace's mail (notifications, invitations) goes
 * out through ITS SMTP credentials when configured, else the platform's.
 * App-level mail (password reset / verification) uses the bare `email` export.
 */
export function emailFor(workspaceId?: string): EmailProvider {
  return {
    async send(message) {
      try {
        const t = await buildSmtpTransport(workspaceId);
        // If SMTP is configured in-app, USE it even when USE_MOCK_EMAIL=true —
        // explicit config always wins over the global mock flag.
        if (!t) {
          if (env.USE_MOCK_EMAIL) return mock.send(message);
          return mock.send(message);
        }
        const info = await t.transport.sendMail({
          from: t.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        return { id: info.messageId };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[email] SMTP send failed → falling back to mock:", e instanceof Error ? e.message : e);
        return mock.send(message);
      }
    },
  };
}

export const email: EmailProvider = emailFor();

/**
 * Send a one-shot test email using the given config (does NOT touch the saved one).
 * Used by the admin "Send test email" button so admins can verify settings BEFORE saving.
 */
export async function sendTestEmail(opts: {
  host: string; port: number; secure: boolean; user: string; pass: string;
  fromName: string; fromEmail: string; to: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    });
    const info = await transport.sendMail({
      from: opts.fromName ? `"${opts.fromName}" <${opts.fromEmail}>` : opts.fromEmail,
      to: opts.to,
      subject: "MeYouSocial SMTP test ✓",
      html: `<p>If you're reading this, SMTP is working.</p>
             <p style="color:#888;font-size:12px;font-family:monospace">Sent from ${opts.host}:${opts.port}${opts.secure ? " (TLS)" : ""}</p>`,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
