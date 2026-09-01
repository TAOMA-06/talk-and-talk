import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "matrix/390/light");
const expected = JSON.parse(
  await readFile(resolve(import.meta.dirname, "../ui2-visual-evidence/routes.ui2.json"), "utf8")
).map(([name]) => name).sort();

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("invalid PNG signature");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const files = (await readdir(root)).filter((file) => /^\d{2}-.+\.png$/.test(file)).sort();
const names = files.map((file) => file.replace(/\.png$/, ""));
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  throw new Error("390/light screenshot names do not match the 31-route matrix");
}

const hashes = new Set();
const dimensionCounts = {};
const tabPageNames = new Set(["02-home", "03-discover", "05-orders", "10-messages", "12-profile"]);
for (const file of files) {
  const buffer = await readFile(resolve(root, file));
  const size = pngDimensions(buffer);
  const name = file.replace(/\.png$/, "");
  const expectedHeight = tabPageNames.has(name) ? 1342 : 1506;
  if (size.width !== 780 || size.height !== expectedHeight) {
    throw new Error(`${file} is ${size.width}x${size.height}; expected 780x${expectedHeight}`);
  }
  const sizeKey = `${size.width}x${size.height}`;
  dimensionCounts[sizeKey] = (dimensionCounts[sizeKey] || 0) + 1;
  hashes.add(createHash("sha256").update(buffer).digest("hex"));
}
if (hashes.size < 20) throw new Error(`only ${hashes.size} unique screenshots; possible repeated-page capture`);

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
if (
  manifest.simulator?.windowWidth !== 390
  || manifest.simulator?.theme !== "light"
  || manifest.routes?.length !== 31
  || manifest.routes.some((route) => route.outcome !== "captured" || route.actualPath !== route.expectedPath)
  || manifest.stateBoundary?.realIdentityToken !== false
  || manifest.stateBoundary?.realRoleSession !== false
  || manifest.stateBoundary?.realOrderOrPaymentData !== false
) {
  throw new Error("390/light manifest does not preserve route matches and the evidence boundary");
}

process.stdout.write(`${JSON.stringify({
  passed: true,
  files: files.length,
  uniqueImages: hashes.size,
  dimensions: dimensionCounts,
  routeMatches: "31/31",
  boundary: "legal-only, no real identity/role/order/payment data"
})}\n`);
