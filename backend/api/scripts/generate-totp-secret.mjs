import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const bytes = randomBytes(20);
let bits = "";
for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
let secret = "";
for (let index = 0; index < bits.length; index += 5) {
  secret += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
}

const username = process.env.STAFF_BOOTSTRAP_USERNAME?.trim().toLowerCase() || "staff";
const issuer = "Talk&Talk";
const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
process.stdout.write(`TOTP secret (store once, then erase this output): ${secret}\n`);
process.stdout.write(`Authenticator URI: ${uri}\n`);
