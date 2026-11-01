import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { shepherdApi } from "./server/shepherdApi";

export default defineConfig({
  plugins: [react(), tailwindcss(), shepherdApi()],
  server: {
    host: "127.0.0.1",
    port: 5194,
    watch: { ignored: ["**/.shepherd/**", "**/.agent-sandbox/**"] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
