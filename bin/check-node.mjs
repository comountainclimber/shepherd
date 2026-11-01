import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function checkNode(version = process.versions.node) {
  const { engines } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const minimum = engines.node.replace(/^>=/, "").split(".").map(Number);
  const current = version.split(".").map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return;
    if (current[index] < minimum[index]) throw new Error(`Shepherd needs Node.js ${engines.node}. This machine has ${version}. Install a newer Node.js and try again.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { checkNode(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
