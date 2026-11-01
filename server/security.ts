import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function createSecurity(origin: () => string | null) {
  const token = randomBytes(32).toString("hex");
  const matches = (value: string | undefined | null) => {
    const candidate = Buffer.from(value ?? "");
    const expected = Buffer.from(token);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  };
  return {
    token,
    address: () => `${origin()}/?token=${token}`,
    allow(req: IncomingMessage, res: ServerResponse): boolean {
      const own = origin();
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      const refuse = (message: string) => {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: message }));
        return false;
      };
      if (!own || req.headers.host !== new URL(own).host ||
          (req.headers.origin !== undefined && req.headers.origin !== own) ||
          req.headers["sec-fetch-site"] === "cross-site") {
        return refuse("Open Shepherd through the address printed in its terminal.");
      }
      let url: URL;
      try {
        url = new URL(req.url ?? "/", own);
        if (url.origin !== own) return refuse("Use Shepherd's own address.");
      } catch {
        return refuse("This request address is not valid.");
      }
      const cookieName = `shepherd_${new URL(own).port}`;
      if (url.pathname === "/" && url.searchParams.has("token")) {
        if (req.method !== "GET" || !matches(url.searchParams.get("token"))) return refuse("This Shepherd token is not valid.");
        res.writeHead(303, {
          "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`,
          Location: "/",
        });
        res.end();
        return false;
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
        if (!matches(bearer) && !matches(cookie)) return refuse("Open the address with the token printed in Shepherd's terminal, or send Authorization: Bearer <token>.");
      }
      return true;
    },
  };
}
