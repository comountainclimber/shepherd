/** GitLab and GitHub also run on private hosts. Only web links to requests are kept. */
export function mergeRequestUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (!/^\/.+\/(?:-\/merge_requests|pull)\/[1-9]\d*\/?$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function reportedMergeRequest(report: string): string | null {
  const links = report.match(/https?:\/\/[^\s<>"`\]\)]+/g) ?? [];
  for (const link of links.reverse()) {
    const url = mergeRequestUrl(link.replace(/[.,;:!]+$/, ""));
    if (url) return url;
  }
  return null;
}
