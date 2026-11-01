#!/usr/bin/env node
import { checkNode } from "./check-node.mjs";

try {
  checkNode();
  const { main } = await import("../dist-server/server.mjs");
  await main();
} catch (error) {
  console.error(`Shepherd: ${error.message}`);
  process.exitCode = 1;
}
