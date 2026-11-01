import { copyFileSync } from "node:fs";
import { build } from "vite";

await build({
  configFile: false,
  build: {
    ssr: "server/standalone.ts",
    outDir: "dist-server",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "server.mjs" } },
  },
});
for (const file of ["look-cli.mjs", "done-cli.mjs"]) copyFileSync(`server/${file}`, `dist-server/${file}`);
