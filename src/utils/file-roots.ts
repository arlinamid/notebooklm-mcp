/**
 * File-system boundaries for tools that read or write local files
 * (`add_source` uploads files to Google; `download_audio` writes to disk).
 *
 * Allowed roots = the MCP client's roots (roots/list, refreshed on
 * notifications/roots/list_changed) ∪ NOTEBOOKLM_FILE_ROOTS. When at least one
 * root is known, every path must resolve (symlinks included) inside one of
 * them. With no roots at all the call is allowed, unless
 * NOTEBOOKLM_REQUIRE_FILE_ROOTS=true.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { log } from "./logger.js";

export class FileRoots {
  private clientRoots: string[] | null = null;

  constructor(private server: Server) {}

  /** Drop the cached client roots (call on notifications/roots/list_changed). */
  invalidate(): void {
    this.clientRoots = null;
  }

  private envRoots(): string[] {
    return (process.env.NOTEBOOKLM_FILE_ROOTS ?? "")
      .split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  private async fetchClientRoots(): Promise<string[]> {
    if (this.clientRoots) return this.clientRoots;
    if (!this.server.getClientCapabilities()?.roots) return [];
    try {
      const { roots } = await this.server.listRoots();
      this.clientRoots = roots
        .filter((r) => r.uri.startsWith("file://"))
        .map((r) => fileURLToPath(r.uri));
    } catch (error) {
      log.warning(`⚠️  roots/list failed: ${error}`);
      this.clientRoots = [];
    }
    return this.clientRoots;
  }

  /** All roots currently in force (resolved to real paths where they exist). */
  async allowedRoots(): Promise<string[]> {
    const all = [...(await this.fetchClientRoots()), ...this.envRoots()];
    return [...new Set(all.map(realish))];
  }

  /**
   * Throw unless `target` is inside an allowed root. `mustExist: false` is for
   * output directories that may not exist yet (their nearest existing parent
   * is checked instead).
   */
  async assertAllowed(target: string, purpose: string): Promise<void> {
    const roots = await this.allowedRoots();
    if (roots.length === 0) {
      if (process.env.NOTEBOOKLM_REQUIRE_FILE_ROOTS === "true") {
        throw new Error(
          `${purpose} is disabled: no file roots are configured. Expose a directory via the ` +
            "MCP client's roots or NOTEBOOKLM_FILE_ROOTS."
        );
      }
      return;
    }
    const resolved = realish(path.resolve(target));
    const ok = roots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!ok) {
      throw new Error(
        `${purpose}: "${target}" is outside the allowed directories (${roots.join(", ")}). ` +
          "Add it to the MCP client's roots or NOTEBOOKLM_FILE_ROOTS."
      );
    }
  }
}

/** Real path of `p`, or of its nearest existing ancestor joined with the rest. */
function realish(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(p);
    rest.unshift(path.basename(current));
    current = parent;
  }
  try {
    return path.join(fs.realpathSync.native(current), ...rest);
  } catch {
    return path.resolve(p);
  }
}
