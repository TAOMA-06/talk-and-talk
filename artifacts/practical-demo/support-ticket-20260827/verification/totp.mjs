import { createHmac } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const normalized = value.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function currentTotp(secret, now = Date.now()) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, "0");
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const secret = process.env.DEMO_TOTP_SECRET;
  if (!secret) throw new Error("DEMO_TOTP_SECRET is required");
  process.stdout.write(`${currentTotp(secret)}\n`);
}
