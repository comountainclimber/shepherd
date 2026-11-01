import { execFile } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const address = process.argv[2];
const only = process.argv[3];
if (!address || !process.env.SHEPHERD_LOOK) {
  console.error('Usage: node scripts/demo-screenshots.mjs "DEMO_ADDRESS" [screenshot-name]\nRun npm run demo first. SHEPHERD_LOOK must point to Shepherd\'s screenshot helper.');
  process.exit(1);
}
const open = (name) => ['--click', `li:has(input[value="${name}"]) button[aria-label="Open step"]`];
const tab = (index) => ['--click', `aside.enter .flex.gap-4 > button:nth-child(${index})`];
const recipes = [
  { name: "task-map-desktop", width: 1440, height: 1000, clicks: [] },
  { name: "task-outline-desktop", width: 1440, height: 1500, clicks: [...open("Handle payment retries"), '--click', 'aside.enter section:last-of-type > button', '--click', 'aside.enter [aria-label="Done when progress"]'] },
  { name: "step-output-desktop", width: 1440, height: 1250, clicks: [...open("Handle payment retries"), ...tab(2)] },
  { name: "step-checks-desktop", width: 1440, height: 1200, clicks: [...open("Build the Apple Pay button"), ...tab(3)] },
  { name: "projects-tasks-desktop", width: 1440, height: 1000, clicks: ['--click', 'button[aria-label="Projects and tasks"]'] },
  { name: "draft-desktop", width: 1440, height: 1000, clicks: ['--click', 'button[aria-label="Projects and tasks"]', '--click', 'button[aria-current="page"] + button'] },
  { name: "agents-desktop", width: 1440, height: 1000, clicks: ['--click', 'header button:has(svg.lucide-users)'] },
  { name: "task-outline-mobile", width: 390, height: 1000, clicks: [] },
  { name: "step-output-mobile", width: 390, height: 1400, clicks: [...open("Handle payment retries"), ...tab(2)] },
  { name: "step-checks-mobile", width: 390, height: 1300, clicks: [...open("Build the Apple Pay button"), ...tab(3)] },
];
const selected = only ? recipes.filter((recipe) => recipe.name === only) : recipes;
if (!selected.length) throw new Error(`Unknown screenshot: ${only}`);
const directory = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
await mkdir(directory, { recursive: true });
for (const recipe of selected) {
  const { stdout } = await execute(process.execPath, [process.env.SHEPHERD_LOOK, address, '--width', String(recipe.width), '--height', String(recipe.height), '--wait', '700', ...recipe.clicks, '--wait', '400'], { timeout: 60000 });
  const source = stdout.split('\n').find((line) => line.trim().endsWith('.png'))?.trim();
  if (!source) throw new Error(`No screenshot returned for ${recipe.name}: ${stdout}`);
  const target = `${directory}${recipe.name}.png`;
  await copyFile(source, target);
  if (!stdout.includes('The page logged no errors.')) throw new Error(`Review page errors for ${recipe.name}: ${stdout}`);
  const { size } = await stat(target);
  console.log(`${recipe.name}.png · ${recipe.width} × ${recipe.height} · ${Math.ceil(size / 1024)} KB · no page errors`);
  if (size > 500 * 1024) throw new Error(`Compress ${recipe.name}.png below 500 KB before keeping it.`);
}
