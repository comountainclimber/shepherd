import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Session {
  url: string;
  token: string;
  guide: string;
  pid: number;
}

export function writeSession(dataDir: string, session: Session) {
  const temporary = path.join(dataDir, `session.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(session), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path.join(dataDir, "session.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function removeSession(dataDir: string, token: string) {
  const file = path.join(dataDir, "session.json");
  let session: Session | null;
  try {
    session = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (session?.token === token) rmSync(file, { force: true });
}
