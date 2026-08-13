import { existsSync, realpathSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

const SAFE_PARTITION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Keep user-controlled partition values portable and out of SQL/path syntax. */
export function validatePartitionValue(value: string, field: string): string {
  const trimmed = value.trim();
  if (!SAFE_PARTITION_VALUE.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(
      `${field} must be 1-100 characters using letters, numbers, dot, underscore or hyphen.`,
    );
  }
  return trimmed;
}

export function partitionSegment(key: string, value: string): string {
  return `${key}=${validatePartitionValue(value, key)}`;
}

export function isPathInside(path: string, root: string): boolean {
  const pathDifference = relative(root, path);
  return (
    pathDifference === '' ||
    (!pathDifference.startsWith(`..${sep}`) &&
      pathDifference !== '..' &&
      !isAbsolute(pathDifference))
  );
}

/** Resolve symlinks before checking roots so an import cannot escape through a junction. */
export function resolveAllowedImportPath(inputPath: string, allowedRoots: string[]): string {
  const resolvedPath = resolve(inputPath);
  if (!existsSync(resolvedPath)) throw new Error(`Import file does not exist: ${resolvedPath}`);

  const realPath = realpathSync(resolvedPath);
  const allowed = allowedRoots.some((root) => {
    if (!existsSync(root)) return false;
    return isPathInside(realPath, realpathSync(root));
  });
  if (!allowed) {
    throw new Error(`Import path is outside WAREHOUSE_IMPORT_ROOTS: ${allowedRoots.join(', ')}`);
  }
  return realPath;
}

export function inferFileExtension(pathOrUrl: string): string {
  return extname(basename(pathOrUrl)).toLowerCase();
}

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
