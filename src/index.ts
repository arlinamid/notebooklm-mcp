#!/usr/bin/env node

/**
 * NotebookLM MCP Server
 *
 * MCP Server for Google NotebookLM - Chat with Gemini 2.5 through NotebookLM
 * with session support and human-like behavior!
 *
 * Features:
 * - Session-based contextual conversations
 * - Auto re-login on session expiry
 * - Human-like typing and mouse movements
 * - Persistent browser fingerprint
 * - Stealth mode with Patchright
 * - Claude Code integration via npx
 *
 * Usage:
 *   npx @arlinamid/notebooklm-mcp
 *   node dist/index.js
 *
 * Environment Variables:
 *   NOTEBOOK_URL - Default NotebookLM notebook URL
 *   AUTO_LOGIN_ENABLED - Enable automatic login (true/false)
 *   LOGIN_EMAIL - Google email for auto-login
 *   LOGIN_PASSWORD - Google password for auto-login
 *   HEADLESS - Run browser in headless mode (true/false)
 *   MAX_SESSIONS - Maximum concurrent sessions (default: 10)
 *   SESSION_TIMEOUT - Session timeout in seconds (default: 900)
 *
 * Based on the Python NotebookLM API implementation
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  SetLevelRequestSchema,
  type CallToolResult,
  type LoggingLevel,
  type PrimitiveSchemaDefinition,
} from "@modelcontextprotocol/sdk/types.js";

import { AuthManager } from "./auth/auth-manager.js";
import { applyAccountToConfig, getRequestedAccount } from "./auth/account-switcher.js";
import { SessionManager } from "./session/session-manager.js";
import { NotebookLibrary } from "./library/notebook-library.js";
import { ToolHandlers, buildToolDefinitions } from "./tools/index.js";
import type { ApprovalFn } from "./tools/handlers.js";
import { ResourceHandlers } from "./resources/resource-handlers.js";
import { PromptHandlers, promptTemplateTools } from "./prompts/prompt-handlers.js";
import { SettingsManager } from "./utils/settings-manager.js";
import { CliHandler } from "./utils/cli-handler.js";
import { CONFIG, NOTEBOOKLM_BASE_URL, ensureDirectories } from "./config.js";
import { startHttpTransport } from "./transport/http.js";
import { log, logger, type LogLevel } from "./utils/logger.js";
import type { AudioFormat, AudioLength } from "./notebooklm/audio.js";
import {
  STUDIO_TYPES,
  prettyOptionValue,
  studioOptionFields,
  type StudioType,
} from "./notebooklm/studio.js";
import { PACKAGE } from "./version.js";
import type { ProgressCallback } from "./types.js";
import { CancelledError, runWithRequestContext } from "./utils/request-context.js";
import { TASK_TOOLS, TaskRunner } from "./tasks/task-runner.js";
import { SERVER_ICONS, toolIcons } from "./icons.js";
import { FileRoots } from "./utils/file-roots.js";
import { OUTPUT_SCHEMAS } from "./tools/output-schemas.js";

/**
 * Server-level instructions consumed by MCP clients during initialization.
 * Per the MCP spec, these describe **cross-tool workflows, ID flows, and
 * constraints** so an LLM agent can use the server end-to-end without prior
 * context. We deliberately keep individual tool descriptions terse — no
 * duplicating workflow advice across every tool.
 *
 * Reference: modelcontextprotocol typescript-sdk → "Server instructions".
 */
const SERVER_INSTRUCTIONS = `# notebooklm-mcp — research with Google NotebookLM

This server lets an LLM run a fully session-based research workflow against
a NotebookLM notebook (chat with Gemini 2.5 grounded on user-uploaded
sources, ingest sources, generate Audio Overviews).

## First-run flow

1. \`get_health\` → if \`authenticated=false\`, run \`setup_auth\` (opens
   a browser tab — user logs in once, cookies persist).
2. \`add_notebook\` to register a NotebookLM share-URL into the local
   library (the user must provide the URL — see add_notebook for the link
   workflow). Optionally \`select_notebook\` to make it the default.
3. \`ask_question\` — start asking. Save the returned \`session_id\` and
   reuse it for follow-up questions to keep context.

## Notebook ID flow

\`list_notebooks\` / \`search_notebooks\` / \`get_notebook\` all return
notebook objects with an \`id\` field. That \`id\` feeds
\`select_notebook\`, \`update_notebook\`, \`remove_notebook\`, and the
optional \`notebook_id\` argument on \`ask_question\` / \`add_source\` /
audio tools.

## Session ID flow

\`ask_question\` returns \`session_id\` on every call. Pass that same id
back as \`session_id\` on later \`ask_question\` calls to maintain a
conversational context (NotebookLM uses session-RAG so follow-ups get
sharper). \`list_sessions\` enumerates live sessions; \`reset_session\`
clears chat history (same id), \`close_session\` ends a session.

## Source ingestion (multi-source)

Call \`add_source\` once per source — text snippets and URLs are supported.
NotebookLM crawls/indexes each source asynchronously; new sources are
typically queryable within 5–30 seconds after \`add_source\` succeeds.

## Audio Overview (async chain — important)

\`generate_audio\` is **non-blocking** by default: it triggers the render
and returns immediately with \`status: "started"\` (or \`"in_progress"\` if
a generation was already running, or \`"ready"\` if one already existed).
Generation typically takes 2–10 minutes.

To complete the workflow, poll \`get_audio_status\` every ~30 s. When it
returns \`status: "ready"\`, call \`download_audio\` with an absolute
\`destination_dir\` to save the file. Calling \`download_audio\` before
\`ready\` will surface a clear error.

For synchronous behaviour pass \`wait_for_completion: true\` to
\`generate_audio\` (legacy mode — blocks for up to \`timeout_ms\`).

## Constraints

- AI usage is metered: a rolling window (resets every few hours) plus a
  weekly limit. \`get_usage\` shows both with reset times; \`re_auth\`
  rotates accounts. Studio jobs can use "Generate later"
  (\`generate_later: true\`) to stay outside the current window.
- Session timeout: ~15 min idle (see \`get_health.session_timeout\`).
- File / YouTube / Drive source uploads are not yet implemented.

## Studio

\`generate_studio_artifact\` creates any Studio output (video, slide_deck,
mind_map, report, flashcards, quiz, infographic, data_table, audio).
Poll \`list_studio_artifacts\` until the item's status is \`ready\`
(\`scheduled\` = queued via Generate later).

Every Studio type except \`report\` (and \`generate_audio\`) accepts
\`sources\` to work from a subset of sources; \`ask_question\` accepts
\`sources\` too (the notebook's own selection is restored afterwards).
\`list_sources\` gives ids for duplicate titles.

\`save_answer_as_note\` pins a chat answer as a note and
\`convert_note_to_source\` turns notes into sources — a worked-out answer
can then be reused as a source.

\`configure_chat\` reads or sets the notebook's persistent **system
instruction** (NotebookLM "Configure Chat": goal, custom prompt, response
length). It shapes every later \`ask_question\` answer on that notebook —
read it before changing it, and restore it afterwards if the change was
only meant for one task.
`;

/**
 * MCP progress tokens are carried in `_meta.progressToken` on the tool-call
 * arguments object. The SDK types arguments as `Record<string, unknown>`,
 * so we narrow defensively.
 */
function extractProgressToken(
  args: Record<string, unknown> | undefined
): string | number | undefined {
  if (!args || typeof args !== "object") return undefined;
  const meta = (args as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return undefined;
  const token = (meta as { progressToken?: unknown }).progressToken;
  return typeof token === "string" || typeof token === "number" ? token : undefined;
}

/**
 * Wrap a handler's `{ success, data?, error? }` result as a CallToolResult:
 * the JSON text for clients that read `content`, the same object as
 * `structuredContent` (validated against the tool's `outputSchema` where one
 * is declared), and `isError` for failures so clients and the SDK can tell
 * them apart without parsing the text.
 */
function toCallToolResult(result: unknown): CallToolResult {
  const isObject = typeof result === "object" && result !== null && !Array.isArray(result);
  const failed = isObject && (result as { success?: unknown }).success === false;
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    ...(isObject && !failed ? { structuredContent: result as Record<string, unknown> } : {}),
    ...(failed ? { isError: true } : {}),
  };
}

/**
 * Main MCP Server Class
 */
class NotebookLMMCPServer {
  private server: Server;
  private authManager: AuthManager;
  private sessionManager: SessionManager;
  private library: NotebookLibrary;
  private toolHandlers: ToolHandlers;
  private resourceHandlers: ResourceHandlers;
  private promptHandlers: PromptHandlers;
  private fileRoots: FileRoots;
  private settingsManager: SettingsManager;
  private toolDefinitions: Tool[];
  private taskRunner: TaskRunner;

  /**
   * Ask the human user to approve an action through MCP elicitation (the
   * client shows a confirm form). Falls back to "unsupported" when the client
   * did not declare the `elicitation` capability, so callers can require an
   * explicit `confirm: true` argument instead.
   */
  private askUserApproval: ApprovalFn = async (
    message,
    confirmLabel = "Yes, delete permanently"
  ) => {
    if (!this.server.getClientCapabilities()?.elicitation) return "unsupported";
    try {
      const res = await this.server.elicitInput({
        message,
        requestedSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              title: confirmLabel,
              description: "Tick to confirm. This cannot be undone.",
            },
          },
          required: ["confirm"],
        },
      });
      if (res.action === "accept") return res.content?.confirm === true ? "approved" : "declined";
      return res.action === "decline" ? "declined" : "cancelled";
    } catch (error) {
      // The client claims support but the prompt failed: do not fall back to
      // the model-supplied `confirm` flag — treat it as not approved.
      log.warning(`⚠️  Approval prompt failed: ${error}`);
      return "cancelled";
    }
  };

  /**
   * Ask the user to pick one option (MCP elicitation, titled single-select
   * enum). Resolves to the chosen value, or null when the client has no
   * elicitation support or the user declines — callers then fall back to an
   * explanatory error.
   */
  private askUserChoice = async (
    message: string,
    options: Array<{ value: string; label: string }>
  ): Promise<string | null> => {
    if (!this.server.getClientCapabilities()?.elicitation || options.length === 0) return null;
    try {
      const res = await this.server.elicitInput({
        message,
        requestedSchema: {
          type: "object",
          properties: {
            choice: {
              type: "string",
              title: "Choose one",
              oneOf: options.slice(0, 50).map((o) => ({ const: o.value, title: o.label })),
            },
          },
          required: ["choice"],
        },
      });
      const choice = res.action === "accept" ? res.content?.choice : undefined;
      return typeof choice === "string" && options.some((o) => o.value === choice) ? choice : null;
    } catch (error) {
      log.warning(`⚠️  Choice prompt failed: ${error}`);
      return null;
    }
  };

  /**
   * Ask the client's model for a short completion (MCP sampling). Null when
   * the client did not declare the `sampling` capability; the client may
   * show the request to the user before running it.
   */
  private askClientModel = async (
    prompt: string,
    opts: { system?: string; maxTokens?: number } = {}
  ): Promise<string | null> => {
    if (!this.server.getClientCapabilities()?.sampling) return null;
    const res = await this.server.createMessage({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      ...(opts.system && { systemPrompt: opts.system }),
      maxTokens: opts.maxTokens ?? 500,
      modelPreferences: { speedPriority: 0.8, costPriority: 0.6, intelligencePriority: 0.3 },
    });
    const blocks = Array.isArray(res.content) ? res.content : [res.content];
    const text = blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return text || null;
  };

  constructor() {
    // Initialize MCP Server
    this.server = new Server(
      {
        name: "notebooklm-mcp",
        title: "NotebookLM MCP",
        version: PACKAGE.version,
        websiteUrl: "https://github.com/arlinamid/notebooklm-mcp",
        icons: SERVER_ICONS,
      },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: true, listChanged: true },
          prompts: {},
          completions: {}, // Required for completion/complete support
          logging: {},
          // Experimental (spec 2025-11-25): long-running tools can run as tasks.
          tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
        },
        // MCP-spec server instructions (clients merge into the system prompt).
        // Use these for cross-tool workflow guidance — do not duplicate
        // information that already lives in individual tool descriptions.
        instructions: SERVER_INSTRUCTIONS,
      }
    );

    // Initialize managers
    this.authManager = new AuthManager();
    this.sessionManager = new SessionManager(this.authManager);
    this.library = new NotebookLibrary();
    this.settingsManager = new SettingsManager();

    // Initialize handlers
    this.toolHandlers = new ToolHandlers(this.sessionManager, this.authManager, this.library);
    this.promptHandlers = new PromptHandlers(this.library);
    this.fileRoots = new FileRoots(this.server);
    this.resourceHandlers = new ResourceHandlers(
      this.library,
      (p, a, v) => this.promptHandlers.complete(p, a, v),
      async (uuid, view, pollKey) => {
        // Subscription polls reuse one dedicated session per notebook.
        const session = await this.sessionManager.getOrCreateSession(
          pollKey,
          `${NOTEBOOKLM_BASE_URL}notebook/${uuid}`
        );
        const items = view === "sources" ? await session.listSources() : await session.listStudio();
        return { notebook: uuid, view, items, read_at: new Date().toISOString() };
      }
    );

    // Build and Filter tool definitions
    const allTools = [...buildToolDefinitions(this.library), ...promptTemplateTools].map((t) => ({
      ...t,
      icons: toolIcons(t.name),
      ...(OUTPUT_SCHEMAS[t.name] && { outputSchema: OUTPUT_SCHEMAS[t.name] }),
      ...(TASK_TOOLS.has(t.name) && { execution: { taskSupport: "optional" } }),
    })) as Tool[];
    this.taskRunner = new TaskRunner(
      (name, args, progress) => this.callTool(name, args, async (m) => progress(m)),
      async (args) => {
        const r = await this.toolHandlers.handleListStudioArtifacts({
          notebook_id: args?.notebook_id as string | undefined,
          notebook_url: args?.notebook_url as string | undefined,
          session_id: args?.session_id as string | undefined,
        });
        return r.success && r.data ? r.data.artifacts : null;
      },
      { choose: this.askUserChoice, sample: this.askClientModel }
    );
    this.toolDefinitions = this.settingsManager.filterTools(allTools);

    // Setup handlers
    this.setupHandlers();
    this.setupShutdownHandlers();

    const activeSettings = this.settingsManager.getEffectiveSettings();
    log.info("🚀 NotebookLM MCP Server initialized");
    log.info(`  Version: ${PACKAGE.version}`);
    log.info(`  Node: ${process.version}`);
    log.info(`  Platform: ${process.platform}`);
    log.info(`  Profile: ${activeSettings.profile} (${this.toolDefinitions.length} tools active)`);
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers(): void {
    // Register Resource Handlers (Resources, Templates, Completions)
    this.resourceHandlers.registerHandlers(this.server);
    this.promptHandlers.registerHandlers(this.server);
    this.taskRunner.register(this.server);
    this.setupClientLogging();
    this.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      log.info("📁 [MCP] Client roots changed");
      this.fileRoots.invalidate();
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      log.info("📋 [MCP] list_tools request received");
      return {
        tools: this.toolDefinitions,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;
      // The spec carries the token in `params._meta`; older clients put it
      // into the arguments object, so accept both.
      const metaToken = request.params._meta?.progressToken;
      const progressToken =
        typeof metaToken === "string" || typeof metaToken === "number"
          ? metaToken
          : extractProgressToken(args);

      log.info(`🔧 [MCP] Tool call: ${name}`);
      if (request.params.task) {
        await this.checkFileAccess(name, args);
        return this.taskRunner.start(request, extra.requestId, extra.sessionId);
      }
      if (progressToken !== undefined) {
        log.info(`  📊 Progress token: ${progressToken}`);
      }

      // Progress goes through `extra.sendNotification` so it reaches the
      // session that made the call (matters for the HTTP transport).
      let progressCount = 0;
      const sendProgress = async (message: string, progress?: number, total?: number) => {
        if (progressToken === undefined) return;
        progressCount = Math.max(progressCount + 1, progress ?? 0);
        await extra.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken,
            message,
            progress: progress ?? progressCount,
            ...(total !== undefined && { total }),
          },
        });
        log.dim(`  📊 Progress: ${message}`);
      };

      return runWithRequestContext(
        {
          signal: extra.signal,
          progress: sendProgress,
          choose: this.askUserChoice,
          sample: this.askClientModel,
        },
        () => this.callTool(name, args, sendProgress)
      );
    });
  }

  /**
   * Forward log lines to the client as notifications/message. The server logs
   * every browser step, so until the client picks a level with logging/setLevel
   * only warnings and errors are sent (NOTEBOOKLM_CLIENT_LOG_LEVEL overrides
   * that default). stderr logging is unchanged.
   */
  private setupClientLogging(): void {
    const order: LoggingLevel[] = [
      "debug",
      "info",
      "notice",
      "warning",
      "error",
      "critical",
      "alert",
      "emergency",
    ];
    const envLevel = process.env.NOTEBOOKLM_CLIENT_LOG_LEVEL as LoggingLevel | undefined;
    let minLevel: LoggingLevel = envLevel && order.includes(envLevel) ? envLevel : "warning";

    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      minLevel = request.params.level;
      log.info(`📝 [MCP] Client log level set to ${minLevel}`);
      return {};
    });

    const toMcp: Record<LogLevel, LoggingLevel> = {
      error: "error",
      warning: "warning",
      info: "info",
      success: "info",
      debug: "debug",
      dim: "debug",
    };
    let sending = false;
    logger.setSink((level, message) => {
      const mcpLevel = toMcp[level];
      if (sending || order.indexOf(mcpLevel) < order.indexOf(minLevel)) return;
      sending = true; // a failed send may log; don't recurse
      this.server
        .sendLoggingMessage({ level: mcpLevel, logger: "notebooklm-mcp", data: message })
        .catch(() => undefined)
        .finally(() => {
          sending = false;
        });
    });
  }

  /**
   * Confirm a destructive local action with the user when the client supports
   * elicitation; clients without it keep the previous behaviour (the tool's
   * own `confirm` flag / description-driven confirmation).
   */
  private async approveLocalAction(message: string, confirmLabel?: string): Promise<boolean> {
    const decision = await this.askUserApproval(message, confirmLabel);
    return decision === "approved" || decision === "unsupported";
  }

  /**
   * `generate_studio_artifact(ask_options: true)`: let the user choose the
   * type's options in a form (MCP elicitation), pre-filled with the given
   * arguments. Returns the merged arguments, the arguments unchanged when the
   * client has no elicitation, or null when the user cancels.
   */
  private async askStudioOptions(
    args: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const type = String(args.type ?? "");
    if (!this.server.getClientCapabilities()?.elicitation || !(type in STUDIO_TYPES)) return args;
    const properties: Record<string, PrimitiveSchemaDefinition> = {};
    for (const f of studioOptionFields(type as StudioType)) {
      const current = args[f.arg];
      if (f.kind === "enum") {
        properties[f.arg] = {
          type: "string",
          title: f.title,
          oneOf: f.values!.map((v) => ({ const: v, title: prettyOptionValue(v) })),
          ...(typeof current === "string" && { default: current }),
        };
      } else if (f.kind === "boolean") {
        properties[f.arg] = {
          type: "boolean",
          title: f.title,
          ...(typeof current === "boolean" && { default: current }),
        };
      } else {
        properties[f.arg] = {
          type: "string",
          title: f.title,
          ...(typeof current === "string" && { default: current }),
        };
      }
    }
    properties.prompt = {
      type: "string",
      title: "Focus / instructions (optional)",
      ...(typeof args.prompt === "string" && { default: args.prompt }),
    };
    properties.generate_later = {
      type: "boolean",
      title: "Generate later (queue instead of starting now)",
      default: args.generate_later === true,
    };
    try {
      const res = await this.server.elicitInput({
        message: `Options for the new ${STUDIO_TYPES[type as StudioType].label}`,
        requestedSchema: { type: "object", properties },
      });
      if (res.action !== "accept") return null;
      const chosen = Object.fromEntries(
        Object.entries(res.content ?? {}).filter(([, v]) => v !== "" && v !== undefined)
      );
      return { ...args, ...chosen };
    } catch (error) {
      log.warning(`⚠️  Options form failed, using the given arguments: ${error}`);
      return args;
    }
  }

  /** Enforce the file roots for tools that touch local files. */
  private async checkFileAccess(
    name: string,
    args: Record<string, unknown> | undefined
  ): Promise<void> {
    if (name === "add_source" && args?.type === "file" && Array.isArray(args.file_paths)) {
      for (const p of args.file_paths) {
        await this.fileRoots.assertAllowed(String(p), "Uploading a local file to NotebookLM");
      }
    }
    if (name === "download_audio" && typeof args?.destination_dir === "string") {
      await this.fileRoots.assertAllowed(args.destination_dir, "Saving the audio file");
    }
  }

  /** Dispatch one tool call and wrap its result as a CallToolResult. */
  private async callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    sendProgress: ProgressCallback
  ): Promise<CallToolResult> {
    {
      try {
        await this.checkFileAccess(name, args);
        let result;

        switch (name) {
          case "ask_question":
            result = await this.toolHandlers.handleAskQuestion(
              args as {
                question: string;
                session_id?: string;
                notebook_id?: string;
                notebook_url?: string;
                show_browser?: boolean;
                source_format?: "none" | "inline" | "footnotes" | "json";
                sources?: string[];
              },
              sendProgress
            );
            break;

          case "add_notebook":
            result = await this.toolHandlers.handleAddNotebook(
              args as {
                url: string;
                name: string;
                description: string;
                topics: string[];
                content_types?: string[];
                use_cases?: string[];
                tags?: string[];
              }
            );
            break;

          case "list_notebooks":
            result = await this.toolHandlers.handleListNotebooks();
            break;

          case "get_notebook":
            result = await this.toolHandlers.handleGetNotebook(args as { id: string });
            break;

          case "select_notebook":
            result = await this.toolHandlers.handleSelectNotebook(args as { id: string });
            break;

          case "update_notebook":
            result = await this.toolHandlers.handleUpdateNotebook(
              args as {
                id: string;
                name?: string;
                description?: string;
                topics?: string[];
                content_types?: string[];
                use_cases?: string[];
                tags?: string[];
                url?: string;
              }
            );
            break;

          case "remove_notebook":
            result = await this.toolHandlers.handleRemoveNotebook(args as { id: string });
            break;

          case "search_notebooks":
            result = await this.toolHandlers.handleSearchNotebooks(args as { query: string });
            break;

          case "get_library_stats":
            result = await this.toolHandlers.handleGetLibraryStats();
            break;

          case "list_sessions":
            result = await this.toolHandlers.handleListSessions();
            break;

          case "close_session":
            result = await this.toolHandlers.handleCloseSession(args as { session_id: string });
            break;

          case "reset_session":
            result = await this.toolHandlers.handleResetSession(args as { session_id: string });
            break;

          case "get_health":
            result = await this.toolHandlers.handleGetHealth();
            break;

          case "setup_auth":
            result = await this.toolHandlers.handleSetupAuth(
              args as { show_browser?: boolean },
              sendProgress
            );
            break;

          case "re_auth":
            if (
              !(await this.approveLocalAction(
                "Sign out of NotebookLM: close all sessions, delete the saved Google login " +
                  "(cookies and Chrome profile) and open a new login window?",
                "Yes, sign out and log in again"
              ))
            ) {
              result = { success: false, error: "Re-authentication cancelled by the user." };
              break;
            }
            result = await this.toolHandlers.handleReAuth(
              args as { show_browser?: boolean },
              sendProgress
            );
            break;

          case "cleanup_data":
            if (
              args?.confirm === true &&
              !(await this.approveLocalAction(
                "Delete the NotebookLM MCP data on this computer (saved login, browser profile, " +
                  `caches, logs${args.preserve_library === true ? "" : " and the notebook library"})? ` +
                  "This cannot be undone."
              ))
            ) {
              result = {
                success: false,
                error: "Cleanup cancelled by the user — nothing was deleted.",
              };
              break;
            }
            result = await this.toolHandlers.handleCleanupData(args as { confirm: boolean });
            break;

          case "add_source":
            result = await this.toolHandlers.handleAddSource(
              args as {
                type: "url" | "text" | "youtube" | "file";
                content?: string;
                title?: string;
                file_paths?: string[];
                show_browser?: boolean;
                session_id?: string;
                notebook_id?: string;
                notebook_url?: string;
              }
            );
            break;

          case "generate_audio":
            result = await this.toolHandlers.handleGenerateAudio(
              args as {
                custom_prompt?: string;
                timeout_ms?: number;
                wait_for_completion?: boolean;
                format?: AudioFormat;
                length?: AudioLength;
                generate_later?: boolean;
                sources?: string[];
                session_id?: string;
                notebook_id?: string;
                notebook_url?: string;
                show_browser?: boolean;
              }
            );
            break;

          case "get_audio_status":
            result = await this.toolHandlers.handleGetAudioStatus(
              args as {
                session_id?: string;
                notebook_id?: string;
                notebook_url?: string;
                show_browser?: boolean;
              }
            );
            break;

          case "download_audio":
            result = await this.toolHandlers.handleDownloadAudio(
              args as {
                destination_dir: string;
                session_id?: string;
                notebook_id?: string;
                notebook_url?: string;
                show_browser?: boolean;
              }
            );
            break;

          case "generate_studio_artifact": {
            const studioArgs =
              args?.ask_options === true ? await this.askStudioOptions(args) : args;
            if (!studioArgs) {
              result = { success: false, error: "Generation cancelled by the user." };
              break;
            }
            result = await this.toolHandlers.handleGenerateStudioArtifact(
              studioArgs as unknown as Parameters<ToolHandlers["handleGenerateStudioArtifact"]>[0]
            );
            break;
          }

          case "list_studio_artifacts":
            result = await this.toolHandlers.handleListStudioArtifacts(
              args as Parameters<ToolHandlers["handleListStudioArtifacts"]>[0]
            );
            break;

          case "delete_source":
            result = await this.toolHandlers.handleDeleteSource(
              args as unknown as Parameters<ToolHandlers["handleDeleteSource"]>[0],
              this.askUserApproval
            );
            break;

          case "delete_studio_artifact":
            result = await this.toolHandlers.handleDeleteStudioArtifact(
              args as unknown as Parameters<ToolHandlers["handleDeleteStudioArtifact"]>[0],
              this.askUserApproval
            );
            break;

          case "list_sources":
            result = await this.toolHandlers.handleListSources(
              args as Parameters<ToolHandlers["handleListSources"]>[0]
            );
            break;

          case "save_answer_as_note":
            result = await this.toolHandlers.handleSaveAnswerAsNote(
              args as Parameters<ToolHandlers["handleSaveAnswerAsNote"]>[0]
            );
            break;

          case "convert_note_to_source":
            result = await this.toolHandlers.handleConvertNoteToSource(
              args as Parameters<ToolHandlers["handleConvertNoteToSource"]>[0]
            );
            break;

          case "configure_chat":
            result = await this.toolHandlers.handleConfigureChat(
              args as Parameters<ToolHandlers["handleConfigureChat"]>[0]
            );
            break;

          case "list_prompt_templates":
            result = {
              success: true,
              data: this.promptHandlers.listTemplates(
                args as Parameters<PromptHandlers["listTemplates"]>[0]
              ),
            };
            break;

          case "get_prompt_template":
            try {
              result = {
                success: true,
                data: this.promptHandlers.getTemplate(
                  args as unknown as Parameters<PromptHandlers["getTemplate"]>[0]
                ),
              };
            } catch (e) {
              result = { success: false, error: e instanceof Error ? e.message : String(e) };
            }
            break;

          case "get_usage":
            result = await this.toolHandlers.handleGetUsage(
              args as Parameters<ToolHandlers["handleGetUsage"]>[0]
            );
            break;

          default:
            log.error(`❌ [MCP] Unknown tool: ${name}`);
            return toCallToolResult({ success: false, error: `Unknown tool: ${name}` });
        }

        // Library edits change the resource list (one resource per notebook).
        if (
          ["add_notebook", "update_notebook", "remove_notebook"].includes(name) &&
          (result as { success?: boolean } | undefined)?.success
        ) {
          void this.resourceHandlers.notifyListChanged();
        }
        return toCallToolResult(result);
      } catch (error) {
        const errorMessage =
          error instanceof CancelledError
            ? "Cancelled by the client."
            : error instanceof Error
              ? error.message
              : String(error);
        log.error(`❌ [MCP] Tool execution error: ${errorMessage}`);
        return toCallToolResult({ success: false, error: errorMessage });
      }
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    let shuttingDown = false;

    const shutdown = async (signal: string) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      log.info(`\n🛑 Received ${signal}, shutting down gracefully...`);

      // Hard ceiling on cleanup so a wedged browser context can't keep the
      // process alive (issue #29 — orphan Chrome on macOS after MCP reconnects).
      // After 5 s we give up gracefully and let `process.exit` reap children.
      const watchdog = setTimeout(() => {
        log.error("⏱️  Shutdown stalled — forcing exit (issue #29 watchdog)");
        process.exit(1);
      }, 5_000);
      watchdog.unref();

      try {
        this.resourceHandlers.stopSubscriptions();
        this.taskRunner.shutdown();
        await this.toolHandlers.cleanup();
        await this.server.close();
        log.success("✅ Shutdown complete");
        clearTimeout(watchdog);
        process.exit(0);
      } catch (error) {
        log.error(`❌ Error during shutdown: ${error}`);
        clearTimeout(watchdog);
        process.exit(1);
      }
    };

    const requestShutdown = (signal: string) => {
      void shutdown(signal);
    };

    process.on("SIGINT", () => requestShutdown("SIGINT"));
    process.on("SIGTERM", () => requestShutdown("SIGTERM"));

    process.on("uncaughtException", (error) => {
      log.error(`💥 Uncaught exception: ${error}`);
      log.error(error.stack || "");
      requestShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      log.error(`💥 Unhandled rejection at: ${promise}`);
      log.error(`Reason: ${reason}`);
      requestShutdown("unhandledRejection");
    });
  }

  /**
   * Start the MCP server using stdio (default) or HTTP transport (issue #4).
   */
  async start(options: TransportOptions = { kind: "stdio" }): Promise<void> {
    log.info("🎯 Starting NotebookLM MCP Server...");
    log.info("");
    log.info("📝 Configuration:");
    log.info(`  Config Dir: ${CONFIG.configDir}`);
    log.info(`  Data Dir: ${CONFIG.dataDir}`);
    log.info(`  Headless: ${CONFIG.headless}`);
    log.info(`  Max Sessions: ${CONFIG.maxSessions}`);
    log.info(`  Session Timeout: ${CONFIG.sessionTimeout}s`);
    log.info(`  Stealth: ${CONFIG.stealthEnabled}`);
    log.info(`  Transport: ${options.kind}`);
    log.info("");

    if (options.kind === "http") {
      await startHttpTransport({
        port: options.port,
        host: options.host,
        connect: async (transport) => {
          await this.server.connect(transport);
        },
      });
      log.success("✅ MCP Server connected via Streamable HTTP");
    } else {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      log.success("✅ MCP Server connected via stdio");
    }

    log.success("🎉 Ready to receive requests from Claude Code!");
    log.info("");
    log.info("💡 Available tools:");
    for (const tool of this.toolDefinitions) {
      const desc = tool.description ? tool.description.split("\n")[0] : "No description";
      log.info(`  - ${tool.name}: ${desc.substring(0, 80)}...`);
    }
    log.info("");
    log.info("📖 For documentation, see: README.md");
    log.info("");
  }
}

type TransportOptions = { kind: "stdio" } | { kind: "http"; port: number; host?: string };

function parseTransportOptions(argv: readonly string[]): TransportOptions {
  let kind: "stdio" | "http" = "stdio";
  let port = 3000;
  let host: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--transport") {
      const next = argv[i + 1];
      if (next === "http" || next === "stdio") {
        kind = next;
        i++;
      }
    } else if (arg.startsWith("--transport=")) {
      const value = arg.slice("--transport=".length);
      if (value === "http" || value === "stdio") kind = value;
    } else if (arg === "--port") {
      const next = argv[i + 1];
      const parsed = next ? Number.parseInt(next, 10) : Number.NaN;
      if (Number.isFinite(parsed)) {
        port = parsed;
        i++;
      }
    } else if (arg.startsWith("--port=")) {
      const parsed = Number.parseInt(arg.slice("--port=".length), 10);
      if (Number.isFinite(parsed)) port = parsed;
    } else if (arg === "--host") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        host = next;
        i++;
      }
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    }
  }

  // Env-var fallbacks for hosted deployments.
  const envTransport = process.env.NOTEBOOKLM_TRANSPORT;
  if (envTransport === "http" || envTransport === "stdio") kind = envTransport;
  const envPort = process.env.NOTEBOOKLM_PORT;
  if (envPort) {
    const parsed = Number.parseInt(envPort, 10);
    if (Number.isFinite(parsed)) port = parsed;
  }
  const envHost = process.env.NOTEBOOKLM_HOST;
  if (envHost) host = envHost;

  if (kind === "http") return { kind, port, host };
  return { kind: "stdio" };
}

/**
 * Main entry point
 */
async function main() {
  // Handle CLI commands
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === "config") {
    const cli = new CliHandler();
    await cli.handleCommand(args);
    process.exit(0);
  }

  // Apply --account / NOTEBOOKLM_ACCOUNT before any directory or browser is
  // touched (issue #2). The account-switcher rewrites CONFIG paths so each
  // Google account gets an isolated Chrome profile + auth state directory.
  const account = getRequestedAccount();
  if (account) {
    applyAccountToConfig(CONFIG, account);
    ensureDirectories();
    log.info(`👤 Account profile active: ${account}`);
  }

  // Print banner
  console.error("╔══════════════════════════════════════════════════════════╗");
  console.error("║                                                          ║");
  const title = `NotebookLM MCP Server v${PACKAGE.version}`;
  const pad = Math.max(0, 58 - title.length);
  console.error(`║${" ".repeat(Math.floor(pad / 2))}${title}${" ".repeat(Math.ceil(pad / 2))}║`);
  console.error("║                                                          ║");
  console.error("║   Chat with Gemini 2.5 through NotebookLM via MCP       ║");
  console.error("║                                                          ║");
  console.error("╚══════════════════════════════════════════════════════════╝");
  console.error("");

  try {
    const transportOptions = parseTransportOptions(args);
    const server = new NotebookLMMCPServer();
    await server.start(transportOptions);
  } catch (error) {
    log.error(`💥 Fatal error starting server: ${error}`);
    if (error instanceof Error) {
      log.error(error.stack || "");
    }
    process.exit(1);
  }
}

// Run the server
main();
