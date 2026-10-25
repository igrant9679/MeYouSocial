import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8),
});

const googleProvider = env.ENABLE_GOOGLE_SSO && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  ? [
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  // Empty → undefined, so a missing AUTH_SECRET makes Auth.js refuse requests
  // rather than sign sessions with something guessable (see lib/env.ts).
  secret: env.AUTH_SECRET || undefined,
  // Trust the host header so Auth.js derives the canonical URL from the incoming
  // request instead of requiring AUTH_URL to be set per environment. This means
  // switching domains (Railway subdomain → custom domain) needs no env change.
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
  providers: [
    ...googleProvider,
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !user.passwordHash) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        await db.user.update({ where: { id: user.id }, data: { lastActivityAt: new Date() } });
        return { id: user.id, email: user.email, name: user.name ?? undefined, image: user.image ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
