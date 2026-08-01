import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const runtimeDirectories = ["public", "config"];

for (const directory of runtimeDirectories) {
  const source = resolve(directory);
  const destination = resolve("dist", directory);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}
