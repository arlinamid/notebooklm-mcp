#!/usr/bin/env node
/**
 * Protocol smoke test (no browser, no Google account): starts dist/index.js
 * over stdio and checks the MCP surface — capabilities, tool list with
 * schemas/icons/task support, prompts, resources and a browser-free tool call
 * — then over Streamable HTTP with several concurrent client sessions.
 *
 *   npm run build && npm run test:smoke
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env,
      stderr: "ignore",
    })
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
  check(
    tools.every((t) => t.description && t.inputSchema?.type === "object"),
    "every tool has description + inputSchema"
  );
  check(
    tools.every((t) => t.icons?.length),
    "every tool has icons"
  );
  const taskTools = tools.filter((t) => t.execution?.taskSupport === "optional").map((t) => t.name);
  check(
    taskTools.includes("generate_studio_artifact") && taskTools.includes("ask_question"),
    "task support",
    taskTools.join(", ")
  );
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
  check(
    resources.some((r) => r.uri === "notebooklm://library"),
    "resources/list has notebooklm://library"
  );
  const { resourceTemplates } = await client.listResourceTemplates();
  check(resourceTemplates.length > 0, "resources/templates/list", `${resourceTemplates.length}`);
  const lib = await client.readResource({ uri: "notebooklm://library" });
  check(lib.contents?.[0]?.text !== undefined, "resources/read notebooklm://library");

  // Browser-free tool call; the client validates structuredContent against outputSchema.
  const res = await client.callTool({ name: "list_prompt_templates", arguments: { limit: 3 } });
  check(
    !res.isError && res.structuredContent?.success === true,
    "tools/call list_prompt_templates (structured)"
  );
  const bad = await client.callTool({ name: "get_notebook", arguments: { id: "does-not-exist" } });
  check(bad.isError === true, "failing tool call sets isError");

  // Preview only (confirm: false) in the isolated home — nothing is deleted.
  const cleanup = await client.callTool({ name: "cleanup_data", arguments: { confirm: false } });
  const preview = JSON.parse(cleanup.content[0].text);
  check(
    preview.success === true && Array.isArray(preview.data?.preview?.categories),
    "cleanup_data preview",
    `${preview.data?.preview?.totalPaths ?? "?"} path(s)`
  );

  await client.setLoggingLevel("error");
  check(true, "logging/setLevel");
} catch (error) {
  check(false, "unexpected error", error?.stack ?? String(error));
} finally {
  await client.close().catch(() => undefined);
}

// Streamable HTTP: several clients at once, each with its own MCP session.
const port = await new Promise((resolve) => {
  const s = createNetServer().listen(0, "127.0.0.1", () => {
    const { port: p } = s.address();
    s.close(() => resolve(p));
  });
});
const httpServer = spawn(
  process.execPath,
  ["dist/index.js", "--transport", "http", "--port", String(port)],
  {
    env,
    stdio: "ignore",
  }
);
try {
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    up = await fetch(`${base}/healthz`).then(
      (r) => r.ok,
      () => false
    );
    if (!up) await new Promise((r) => setTimeout(r, 200));
  }
  check(up, "HTTP /healthz");
  const clients = [1, 2, 3].map((n) => new Client({ name: `smoke-http-${n}`, version: "1.0.0" }));
  await Promise.all(
    clients.map((c) => c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`))))
  );
  const counts = await Promise.all(clients.map((c) => c.listTools().then((r) => r.tools.length)));
  check(
    counts.every((n) => n === counts[0] && n > 0),
    "HTTP: 3 concurrent sessions list tools",
    counts.join("/")
  );
  const calls = await Promise.all(
    clients.map((c) => c.callTool({ name: "list_prompt_templates", arguments: { limit: 1 } }))
  );
  check(
    calls.every((r) => !r.isError),
    "HTTP: tool call on every session"
  );
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
} catch (error) {
  check(false, "HTTP transport", error?.stack ?? String(error));
} finally {
  httpServer.kill();
  await new Promise((r) => (httpServer.exitCode !== null ? r() : httpServer.once("exit", r)));
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
