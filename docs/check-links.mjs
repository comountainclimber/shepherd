import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(file, "utf8");
const withoutCode = (text) => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = [path.join(root, "README.md"), ...walk(path.join(root, "docs"))]
  .filter((file) => /\.(md|svg|css)$/.test(file));
const errors = [];
const external = new Set();
let checked = 0;

function anchors(file) {
  const text = withoutCode(read(file));
  const found = new Set([...text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)].map((match) => match[1]));
  const counts = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = match[1].replace(/<[^>]+>/g, "").toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    found.add(count ? `${slug}-${count}` : slug);
  }
  return found;
}

function check(file, raw) {
  const url = raw.trim().replace(/^<|>$/g, "").replace(/&amp;/g, "&");
  if (/^(?:https?:|mailto:)/i.test(url)) {
    external.add(url);
    return;
  }
  if (/^data:/i.test(url)) return;
  checked++;
  const fail = (message) => errors.push(`${path.relative(root, file)}: ${raw} — ${message}`);
  if (/^(?:\/\/|[a-z][a-z\d+.-]*:)/i.test(url)) return fail("unsupported destination");
  let target, fragment;
  try {
    const [pathname, hash] = url.split("#", 2);
    target = path.resolve(pathname ? path.dirname(file) : "", pathname ? decodeURIComponent(pathname.split("?")[0]) : file);
    fragment = hash && decodeURIComponent(hash);
  } catch {
    return fail("invalid URL encoding");
  }
  if (target !== root && !target.startsWith(root + path.sep)) return fail("outside repository");
  if (!existsSync(target)) return fail("missing path");
  if (fragment && target.endsWith(".md") && !anchors(target).has(fragment)) return fail("missing heading or anchor");
  if (fragment && target.endsWith(".svg") && !read(target).includes(`id="${fragment}"`)) return fail("missing SVG id");
  if (statSync(target).isDirectory() && fragment) return fail("fragment targets a directory");
}

for (const file of files) {
  let text = file.endsWith(".md") ? withoutCode(read(file)) : read(file);
  if (file.endsWith(".md")) {
    // Images may sit inside links; remove the inner image before finding its link.
    text = text.replace(/!\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (_, url) => {
      check(file, url);
      return "image";
    });
    for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) check(file, match[1]);
    for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) check(file, match[1]);
  }
  for (const match of text.matchAll(/\b(?:src|href|xlink:href)=["']([^"']+)["']/g)) check(file, match[1]);
  for (const match of text.matchAll(/\bsrcset=["']([^"']+)["']/g)) {
    for (const source of match[1].split(",")) check(file, source.trim().split(/\s+/)[0]);
  }
  if (file.endsWith(".css") || file.endsWith(".svg")) {
    for (const match of text.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) check(file, match[1]);
  }
}

const version = JSON.parse(read(path.join(root, "package.json"))).version;
if (!read(path.join(root, "docs/badges/npm.svg")).includes(`>v${version}</text>`)) {
  errors.push("docs/badges/npm.svg: source version differs from package.json");
}
if (!read(path.join(root, "README.md")).includes(`npm source version: ${version}`)) {
  errors.push("README.md: npm badge alt text differs from package.json");
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} local destinations across ${files.length} files: all resolve.`);
}
if (external.size) console.log(`External destinations (not fetched):\n${[...external].join("\n")}`);
