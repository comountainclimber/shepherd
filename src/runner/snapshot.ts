export interface FileStamp {
  path: string;
  size: number;
  mtimeMs: number;
}

export function changedPaths(before: FileStamp[], after: FileStamp[]): string[] {
  const previous = new Map(before.map((file) => [file.path, file]));
  return after
    .filter((file) => {
      const prior = previous.get(file.path);
      return !prior || prior.size !== file.size || prior.mtimeMs !== file.mtimeMs;
    })
    .map((file) => file.path);
}
