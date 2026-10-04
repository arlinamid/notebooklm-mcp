/**
 * Minimal glob for the cleanup scan. Patterns are relative to a base
 * directory, use `/` separators, `*` within a segment and `**` for any depth
 * — enough for fixed patterns like `*\/node_modules/notebooklm-mcp` or
 * `**\/exthost/**\/*notebooklm*.log`. Replaces `globby`, whose dependency
 * chain (micromatch → braces / picomatch) carries unfixed advisories.
 *
 * Symlinked directories are not followed, recursion is depth-limited and
 * unreadable directories are skipped.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

export interface SimpleGlobOptions {
  /** Which entries the last segment may match. Default "any". */
  type?: "dir" | "file" | "any";
  /** Maximum directories descended for `**`. Default 12. */
  maxDepth?: number;
}

function segmentRegExp(segment: string): RegExp {
  const source = segment
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
}

export async function simpleGlob(
  base: string,
  pattern: string,
  options: SimpleGlobOptions = {}
): Promise<string[]> {
  const type = options.type ?? "any";
  const maxDepth = options.maxDepth ?? 12;
  const segments = pattern.split("/").filter(Boolean);
  const found = new Set<string>();

  async function walk(dir: string, index: number, depth: number): Promise<void> {
    const segment = segments[index];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (segment === "**") {
      if (index + 1 < segments.length) await walk(dir, index + 1, depth);
      if (depth >= maxDepth) return;
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          await walk(path.join(dir, entry.name), index, depth + 1);
        }
      }
      return;
    }

    const re = segmentRegExp(segment);
    const last = index === segments.length - 1;
    for (const entry of entries) {
      if (!re.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (last) {
        const ok =
          type === "any" ||
          (type === "dir" && entry.isDirectory()) ||
          (type === "file" && entry.isFile());
        if (ok) found.add(full);
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(full, index + 1, depth);
      }
    }
  }

  if (segments.length > 0) await walk(path.resolve(base), 0, 0);
  return [...found];
}
