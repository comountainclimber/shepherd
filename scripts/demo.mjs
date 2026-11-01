import { createServer } from "vite";
import { fileURLToPath } from "node:url";

// Load the TypeScript launcher without adding another runtime dependency.
const loader = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: "custom" });
let startDemo;
try {
  ({ startDemo } = await loader.ssrLoadModule("/server/demo.ts"));
} finally {
  await loader.close();
}
const demo = await startDemo({ distDir: fileURLToPath(new URL("../dist/", import.meta.url)) });
console.log(`\nShepherd demo: ${demo.address}\n\nA fresh throwaway board. All activity is made up; agent runs are disabled.\nKeep this terminal running. Press Ctrl+C to stop and remove the board.\n`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await demo.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
