import { seal, open, type Sealed } from "@/lib/keyring";

// AES-256-GCM secret storage (ported from Spark's lib/crypto.ts): the WordPress
// application password, OAuth refresh tokens and two-factor secrets, stored as
// JSON {kid, iv, tag, data}. The key comes from the keyring (lib/keyring.ts,
// E-SEC-04): `kid` names it, and one written before the keyring has no `kid`
// and is read by trying each configured key.

export type Encrypted = Sealed;

export function encryptSecret(plain: string): Encrypted {
  return seal(plain);
}

export function decryptSecret(enc: Encrypted): string {
  return open(enc);
}
