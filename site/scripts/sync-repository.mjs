import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const { repository } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const url = new URL(repository.url.replace(/\.git$/, ''));
if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !/^\/[\w.-]+\/[\w.-]+$/.test(url.pathname)) {
  throw new Error('Expected a GitHub HTTPS repository URL in package.json');
}
const base = url.href.replace(/\/$/, '');
const index = new URL('site/index.html', root);
const html = await readFile(index, 'utf8');
await writeFile(index, html.replace(/data-repo="([^"]*)" href="[^"]*"/g, (_, suffix) => `data-repo="${suffix}" href="${base}${suffix}"`));
console.log('Updated static repository links from package.json.');
