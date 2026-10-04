#!/usr/bin/env node
/**
 * Protocol smoke test (no browser, no Google account): starts dist/index.js
 * over stdio and checks the MCP surface — capabilities, tool list with
 * schemas/icons/task support, prompts, resources and a browser-free tool call.
 *
 *   npm run build && npm run test:smoke
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

// Isolated data/config dirs so the test never touches a real profile.
const home = mkdtempSync(join(tmpdir(), "nlm-smoke-"));
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: join(home, "AppData", "Local"),
  APPDATA: join(home, "AppData", "Roaming"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CONFIG_HOME: join(home, ".config"),
  HEADLESS: "true",
  NOTEBOOKLM_PROFILE: "full",
};

const client = new Client({ name: "smoke-test", version: "1.0.0" });
try {
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "ignore" })
  );

  const caps = client.getServerCapabilities() ?? {};
  for (const c of ["tools", "resources", "prompts", "completions", "logging", "tasks"]) {
    check(c in caps, `capability ${c}`);
  }
  check(caps.resources?.subscribe === true, "resources.subscribe");

  const info = client.getServerVersion();
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  check(info?.version === pkg.version, "serverInfo.version matches package.json", info?.version);
  check((info?.icons?.length ?? 0) > 0, "server icons");

  const { tools } = await client.listTools();
  check(tools.length >= 31, "tools/list", `${tools.length} tools`);
  check(tools.every((t) => t.description && t.inputSchema?.type === "object"), "every tool has description + inputSchema");
  check(tools.every((t) => t.icons?.length), "every tool has icons");
  const taskTools = tools.filter((t) => t.execution?.taskSupport === "optional").map((t) => t.name);
  check(taskTools.includes("generate_studio_artifact") && taskTools.includes("ask_question"), "task support", taskTools.join(", "));
  const withSchema = tools.filter((t) => t.outputSchema).map((t) => t.name);
  check(withSchema.length >= 4, "outputSchema", withSchema.join(", "));
  check(
    tools.find((t) => t.name === "add_notebook")?.inputSchema.required?.join(",") === "url,name",
    "add_notebook requires only url + name"
  );

  const { prompts } = await client.listPrompts();
  check(prompts.length > 50, "prompts/list", `${prompts.length} prompts (first page)`);
  const got = await client.getPrompt({ name: prompts[0].name, arguments: {} }).catch((e) => e);
  check(Array.isArray(got?.messages) && got.messages.length > 0, "prompts/get", prompts[0].name);

  const { resources } = await client.listResources();
  check(resources.some((r) => r.uri === "notebooklm://library"), "resources/list has notebooklm://library");
  const { resourceTemplates } = await client.listResourceTemplates();
  check(resourceTemplates.length > 0, "resources/templates/list", `${resourceTemplates.length}`);
  const lib = await client.readResource({ uri: "notebooklm://library" });
  check(lib.contents?.[0]?.text !== undefined, "resources/read notebooklm://library");

  // Browser-free tool call; the client validates structuredContent against outputSchema.
  const res = await client.callTool({ name: "list_prompt_templates", arguments: { limit: 3 } });
  check(!res.isError && res.structuredContent?.success === true, "tools/call list_prompt_templates (structured)");
  const bad = await client.callTool({ name: "get_notebook", arguments: { id: "does-not-exist" } });
  check(bad.isError === true, "failing tool call sets isError");

  await client.setLoggingLevel("error");
  check(true, "logging/setLevel");
} catch (error) {
  check(false, "unexpected error", error?.stack ?? String(error));
} finally {
  await client.close().catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
