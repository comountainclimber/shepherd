import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";

it("checks the package engines before loading the app and explains an older Node version", () => {
  const { engines } = JSON.parse(readFileSync("package.json", "utf8"));
  const check = (version: string) => execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { checkNode } from './bin/check-node.mjs';
    try { checkNode(${JSON.stringify(version)}); console.log('supported'); }
    catch (error) { console.log(error.message); }
  `], { encoding: "utf8" });
  expect(check("20.19.0")).toContain(`Shepherd needs Node.js ${engines.node}. This machine has 20.19.0.`);
  expect(check("22.11.0")).toContain("Install a newer Node.js");
  expect(check(engines.node.slice(2)).trim()).toBe("supported");
  expect(check("24.0.0").trim()).toBe("supported");
});
