/**
 * Package name and version, read once from package.json so the MCP
 * `serverInfo`, the startup banner and logs never drift from the release.
 */

import fs from "fs";

interface PackageMeta {
  name: string;
  version: string;
}

function readPackageMeta(): PackageMeta {
  try {
    // dist/version.js → ../package.json (also correct for src/ under tsx)
    const raw = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as Partial<PackageMeta>;
    return { name: pkg.name ?? "notebooklm-mcp", version: pkg.version ?? "0.0.0" };
  } catch {
    return { name: "notebooklm-mcp", version: "0.0.0" };
  }
}

export const PACKAGE = readPackageMeta();
