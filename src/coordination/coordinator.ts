/**
 * One browser per Google account across server instances.
 *
 * Several MCP clients (e.g. Claude Desktop's chat and its Code tab) each start
 * their own notebooklm-mcp process on the same data directory. Each used to
 * launch its own Chrome on the same profile; the second fell back to an
 * isolated profile seeded with saved cookies, so one Google session ran in two
 * browsers at once (which Google may revoke), and the library file had two
 * writers.
 *
 * Now the first instance becomes the *leader*: it writes `leader.json` (pid,
 * port, random token) with an exclusive create, serves an internal
 * Streamable-HTTP endpoint on 127.0.0.1 that requires the token, and is the
 * only one that opens a browser or writes the library. Every other instance is
 * a *follower*: it forwards tool calls to the leader and relays the leader's
 * requests back to its own client — elicitation (approvals), sampling and
 * roots — plus progress notifications. When the leader goes away, the next
 * call re-runs the election (a dead pid's lock file is removed) and retries
 * once, if the leader could not be reached at all.
 *
 * Opt out with NOTEBOOKLM_SINGLE_BROWSER=false.
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolResultSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { log } from "../utils/logger.js";

export type Role = "leader" | "follower" | "standalone";

interface LeaderInfo {
  pid: number;
  port: number;
  token: string;
  version: string;
  startedAt: string;
}

export interface LeaderEndpoint {
  port: number;
  close: () => Promise<void>;
}

/** Tools that never touch the browser or the library — always served locally. */
const LOCAL_TOOLS = new Set(["list_prompt_templates", "get_prompt_template"]);

/** Longest a forwarded call may stay silent (progress resets it). */
const FORWARD_TIMEOUT_MS = 60 * 60_000;

type Progress = (message: string, progress?: number, total?: number) => Promise<void>;

export class InstanceCoordinator {
  private role: Role = "standalone";
  private leader: LeaderInfo | null = null;
  private endpoint: LeaderEndpoint | null = null;
  private proxies = new WeakMap<Server, Promise<Client>>();
  private election: Promise<void> | null = null;

  constructor(
    private lockPath: string,
    private version: string,
    /** Start the token-protected internal endpoint (called once, when this instance leads). */
    private startEndpoint: (token: string) => Promise<LeaderEndpoint>,
    private enabled = process.env.NOTEBOOKLM_SINGLE_BROWSER?.toLowerCase() !== "false"
  ) {}

  get currentRole(): Role {
    return this.role;
  }

  /** Run the election (idempotent while one is in flight). */
  init(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.election ??= this.elect().finally(() => (this.election = null));
    return this.election;
  }

  /** True when `tool` must run on the leader instead of here. */
  forwards(tool: string): boolean {
    return this.role === "follower" && !LOCAL_TOOLS.has(tool);
  }

  /**
   * Forward a tool call to the leader on behalf of `upstream` (this
   * instance's client connection). Returns null if this instance became the
   * leader during a re-election — the caller then runs the call itself.
   */
  async forward(
    upstream: Server,
    name: string,
    args: Record<string, unknown> | undefined,
    progress: Progress,
    signal?: AbortSignal
  ): Promise<CallToolResult | null> {
    for (let attempt = 0; ; attempt++) {
      if (this.role !== "follower") return null;
      try {
        const client = await this.proxyFor(upstream);
        return (await client.callTool({ name, arguments: args }, CallToolResultSchema, {
          signal,
          timeout: FORWARD_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          onprogress: (p) => void progress(p.message ?? "", p.progress, p.total),
        })) as CallToolResult;
      } catch (error) {
        // Only an unreachable leader is retried: a call that reached it may
        // have had effects (a Studio render, a new source) and must not repeat.
        if (!isUnreachable(error) || attempt > 0) throw error;
        log.warning(`⚠️  Leader instance unreachable (${String(error)}) — re-electing`);
        this.proxies = new WeakMap();
        this.role = "standalone";
        await this.init();
      }
    }
  }

  /** Tell the leader the client's roots changed (it caches them per connection). */
  async rootsChanged(upstream: Server): Promise<void> {
    const client = await this.proxies.get(upstream)?.catch(() => null);
    await client?.sendRootsListChanged().catch(() => undefined);
  }

  /** Release leadership (shutdown). */
  async release(): Promise<void> {
    if (this.role !== "leader") return;
    try {
      const info = readLock(this.lockPath);
      if (info?.pid === process.pid) fs.unlinkSync(this.lockPath);
    } catch {
      /* already gone */
    }
    await this.endpoint?.close().catch(() => undefined);
    this.role = "standalone";
  }

  private async elect(): Promise<void> {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    for (let attempt = 0; attempt < 20; attempt++) {
      let fd: number;
      try {
        fd = fs.openSync(this.lockPath, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = readLock(this.lockPath);
        if (!info) {
          // Being written right now, or garbage left by a crash.
          if (lockAgeMs(this.lockPath) > 5_000) removeLock(this.lockPath);
          await sleep(250);
          continue;
        }
        // A reused pid looks alive; the endpoint answering is the real test.
        if (info.pid === process.pid || !pidAlive(info.pid) || !(await healthy(info.port))) {
          if (info.pid !== process.pid && pidAlive(info.pid) && lockAgeMs(this.lockPath) < 10_000) {
            await sleep(500); // a leader that has just started may not listen yet
            continue;
          }
          removeLock(this.lockPath);
          continue;
        }
        this.role = "follower";
        this.leader = info;
        if (info.version !== this.version) {
          log.warning(
            `⚠️  Leader instance runs ${info.version}, this one ${this.version} — ` +
              "tool calls are forwarded to the leader's version."
          );
        }
        log.info(`🤝 Following leader instance pid ${info.pid} (port ${info.port})`);
        return;
      }

      try {
        const token = randomBytes(32).toString("hex");
        this.endpoint = await this.startEndpoint(token);
        const info: LeaderInfo = {
          pid: process.pid,
          port: this.endpoint.port,
          token,
          version: this.version,
          startedAt: new Date().toISOString(),
        };
        fs.writeSync(fd, JSON.stringify(info));
        fs.closeSync(fd);
        this.role = "leader";
        this.leader = info;
        log.success(`👑 Leader instance — other instances forward to port ${info.port}`);
        return;
      } catch (error) {
        fs.closeSync(fd);
        removeLock(this.lockPath);
        throw error;
      }
    }
    log.warning("⚠️  Could not settle the instance election — running standalone");
    this.role = "standalone";
  }

  /** One MCP client to the leader per upstream connection, mirroring its capabilities. */
  private proxyFor(upstream: Server): Promise<Client> {
    let pending = this.proxies.get(upstream);
    if (!pending) {
      pending = this.connectProxy(upstream);
      pending.catch(() => this.proxies.delete(upstream));
      this.proxies.set(upstream, pending);
    }
    return pending;
  }

  private async connectProxy(upstream: Server): Promise<Client> {
    const leader = this.leader;
    if (!leader) throw new Error("No leader instance known.");
    const caps = upstream.getClientCapabilities() ?? {};
    const client = new Client(
      { name: "notebooklm-mcp-follower", version: this.version },
      {
        capabilities: {
          ...(caps.elicitation && { elicitation: caps.elicitation }),
          ...(caps.sampling && { sampling: caps.sampling }),
          ...(caps.roots && { roots: { listChanged: true } }),
        },
      }
    );
    // The leader asks "its" client — relay to ours.
    if (caps.elicitation) {
      client.setRequestHandler(ElicitRequestSchema, (req) => upstream.elicitInput(req.params));
    }
    if (caps.sampling) {
      client.setRequestHandler(CreateMessageRequestSchema, (req) =>
        upstream.createMessage(req.params)
      );
    }
    if (caps.roots) {
      client.setRequestHandler(ListRootsRequestSchema, () => upstream.listRoots());
    }
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${leader.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${leader.token}` } },
      })
    );
    return client;
  }
}

function readLock(lockPath: string): LeaderInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LeaderInfo;
    return typeof info.pid === "number" && typeof info.port === "number" && info.token
      ? info
      : null;
  } catch {
    return null;
  }
}

function removeLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* someone else removed it */
  }
}

function lockAgeMs(lockPath: string): number {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: exists but owned by someone else — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The leader's port refused the connection (it is gone) — safe to retry. */
function isUnreachable(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code === "ECONNREFUSED" || /ECONNREFUSED/.test(String(error));
}

async function healthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
