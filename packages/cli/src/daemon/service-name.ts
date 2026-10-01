import path from 'node:path';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateServiceName(
  dirPath: string,
  label?: string,
  pathModule: Pick<typeof path, 'resolve' | 'parse' | 'sep'> = path,
): string {
  if (label) return `com.syncthis.${slugify(label)}`;
  const resolved = pathModule.resolve(dirPath);
  // Strip the root (`/`, `D:\`, `\\server\share\`) so it never leaks into the name.
  const relative = resolved.slice(pathModule.parse(resolved).root.length);
  const segments = relative.split(pathModule.sep).filter(Boolean);
  const lastTwo = segments.slice(-2).join('-');
  return `com.syncthis.${slugify(lastTwo)}`;
}
