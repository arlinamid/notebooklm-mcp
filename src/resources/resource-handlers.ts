import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { NotebookLibrary } from "../library/notebook-library.js";
import { log } from "../utils/logger.js";

/** Live notebook views exposed as resources. */
export type NotebookView = "sources" | "studio";

/**
 * Reads a live notebook view through a browser session. `pollKey` selects a
 * dedicated session for subscription polling so ticks reuse one page.
 */
export type NotebookReader = (
  notebookId: string,
  view: NotebookView,
  pollKey?: string
) => Promise<unknown>;

const NOTEBOOK_URI = /^notebooklm:\/\/notebook\/([0-9a-f-]{36})\/(sources|studio)$/;
const PAGE_SIZE = 50;
const POLL_MS = Math.max(15_000, Number(process.env.NOTEBOOKLM_SUBSCRIPTION_POLL_MS) || 60_000);

/**
 * Change fingerprint for a notebook view: only identity and state fields, so
 * relative ages ("2m ago") don't fire an update every minute.
 */
function fingerprint(view: NotebookView, data: unknown): string {
  const list = ((data as { items?: unknown[] })?.items ?? []) as Array<Record<string, unknown>>;
  const keys = view === "studio" ? ["id", "title", "status"] : ["id", "title", "selected"];
  return JSON.stringify(list.map((e) => keys.map((k) => e[k])));
}

function notebookUuid(url: string): string | null {
  return url.match(/\/notebook\/([0-9a-f-]{36})/)?.[1] ?? null;
}

/**
 * Handlers for MCP Resource-related requests
 */
export class ResourceHandlers {
  private library: NotebookLibrary;
  /** Completion source for prompt arguments (prompts/get), if prompts are enabled. */
  private promptCompleter?: (prompt: string, arg: string, value: string) => string[];
  private notebookReader?: NotebookReader;
  private subscriptions = new Map<string, { timer: NodeJS.Timeout; last: string; busy: boolean }>();
  private server?: Server;

  constructor(
    library: NotebookLibrary,
    promptCompleter?: (prompt: string, arg: string, value: string) => string[],
    notebookReader?: NotebookReader
  ) {
    this.library = library;
    this.promptCompleter = promptCompleter;
    this.notebookReader = notebookReader;
  }

  /** Tell the client the resource list changed (library edits). */
  async notifyListChanged(): Promise<void> {
    await this.server?.sendResourceListChanged().catch(() => undefined);
  }

  /** Stop every subscription poller (server shutdown). */
  stopSubscriptions(): void {
    for (const s of this.subscriptions.values()) clearInterval(s.timer);
    this.subscriptions.clear();
  }

  private async readNotebookView(uri: string, pollKey?: string): Promise<unknown> {
    const m = uri.match(NOTEBOOK_URI);
    if (!m || !this.notebookReader) throw new Error(`Unknown resource: ${uri}`);
    return this.notebookReader(m[1], m[2] as NotebookView, pollKey);
  }

  /**
   * Register all resource handlers to the server
   */
  public registerHandlers(server: Server): void {
    this.server = server;

    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const { uri } = request.params;
      if (!NOTEBOOK_URI.test(uri)) {
        throw new Error(
          `Only live notebook views can be subscribed to (notebooklm://notebook/{id}/sources|studio), got ${uri}`
        );
      }
      if (this.subscriptions.has(uri)) return {};
      const pollKey = `sub-${uri.match(NOTEBOOK_URI)![1].slice(0, 8)}`;
      const view = uri.match(NOTEBOOK_URI)![2] as NotebookView;
      const entry = { timer: undefined as unknown as NodeJS.Timeout, last: "", busy: false };
      try {
        entry.last = fingerprint(view, await this.readNotebookView(uri, pollKey));
      } catch (e) {
        log.warning(`⚠️  [MCP] initial read for subscription ${uri} failed: ${e}`);
      }
      entry.timer = setInterval(async () => {
        if (entry.busy) return;
        entry.busy = true;
        try {
          const fp = fingerprint(view, await this.readNotebookView(uri, pollKey));
          if (fp !== entry.last) {
            entry.last = fp;
            log.info(`🔔 [MCP] resource updated: ${uri}`);
            await server.sendResourceUpdated({ uri });
          }
        } catch (e) {
          log.warning(`⚠️  [MCP] subscription poll ${uri} failed: ${e}`);
        } finally {
          entry.busy = false;
        }
      }, POLL_MS);
      entry.timer.unref();
      this.subscriptions.set(uri, entry);
      log.info(`🔔 [MCP] subscribed: ${uri} (every ${POLL_MS / 1000}s)`);
      return {};
    });

    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const entry = this.subscriptions.get(request.params.uri);
      if (entry) {
        clearInterval(entry.timer);
        this.subscriptions.delete(request.params.uri);
        log.info(`🔕 [MCP] unsubscribed: ${request.params.uri}`);
      }
      return {};
    });

    // List available resources (paginated)
    server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      log.info("📚 [MCP] list_resources request received");
      const all = this.buildResourceList();
      const start = Number(request.params?.cursor ?? 0) || 0;
      return {
        resources: all.slice(start, start + PAGE_SIZE),
        ...(start + PAGE_SIZE < all.length ? { nextCursor: String(start + PAGE_SIZE) } : {}),
      };
    });
    this.registerOtherHandlers(server);
  }

  /** Static library resources plus live views for every library notebook. */
  private buildResourceList() {
    {
      const notebooks = this.library.listNotebooks();
      type ResourceDescriptor = {
        uri: string;
        name: string;
        description: string;
        mimeType: string;
      };
      const resources: ResourceDescriptor[] = [
        {
          uri: "notebooklm://library",
          name: "Notebook Library",
          description:
            "Complete notebook library with all available knowledge sources. " +
            "Read this to discover what notebooks are available. " +
            "⚠️ If you think a notebook might help with the user's task, " +
            "ASK THE USER FOR PERMISSION before consulting it: " +
            "'Should I consult the [notebook] for this task?'",
          mimeType: "application/json",
        },
      ];

      // Add individual notebook resources
      for (const notebook of notebooks) {
        resources.push({
          uri: `notebooklm://library/${notebook.id}`,
          name: notebook.name,
          description:
            `${notebook.description} | Topics: ${notebook.topics.join(", ")} | ` +
            `💡 Use ask_question to query this notebook (ask user permission first if task isn't explicitly about these topics)`,
          mimeType: "application/json",
        });
        const uuid = notebookUuid(notebook.url);
        if (uuid && this.notebookReader) {
          resources.push(
            {
              uri: `notebooklm://notebook/${uuid}/sources`,
              name: `${notebook.name} — sources`,
              description:
                "Live list of the notebook's sources (id, title, kind, chat selection). Subscribable.",
              mimeType: "application/json",
            },
            {
              uri: `notebooklm://notebook/${uuid}/studio`,
              name: `${notebook.name} — Studio`,
              description:
                "Live Studio library (outputs and notes with status). Subscribe to be notified when a generation finishes.",
              mimeType: "application/json",
            }
          );
        }
      }

      // Add legacy metadata resource for backwards compatibility
      const active = this.library.getActiveNotebook();
      if (active) {
        resources.push({
          uri: "notebooklm://metadata",
          name: "Active Notebook Metadata (Legacy)",
          description:
            "Information about the currently active notebook. " +
            "DEPRECATED: Use notebooklm://library instead for multi-notebook support. " +
            "⚠️ Always ask user permission before using notebooks for tasks they didn't explicitly mention.",
          mimeType: "application/json",
        });
      }

      return resources;
    }
  }

  private registerOtherHandlers(server: Server): void {
    // List resource templates
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      log.info("📑 [MCP] list_resource_templates request received");

      return {
        resourceTemplates: [
          {
            uriTemplate: "notebooklm://notebook/{notebook}/sources",
            name: "Notebook sources (live)",
            description:
              "Live source list of any notebook by its UUID (the part after /notebook/ in its URL). " +
              "Read opens the notebook in the browser; subscribe to get notified when sources change.",
            mimeType: "application/json",
          },
          {
            uriTemplate: "notebooklm://notebook/{notebook}/studio",
            name: "Notebook Studio (live)",
            description:
              "Live Studio library of any notebook by UUID: outputs and notes with their status. " +
              "Subscribe to get notified when a generation finishes instead of polling.",
            mimeType: "application/json",
          },
          {
            uriTemplate: "notebooklm://library/{id}",
            name: "Notebook by ID",
            description:
              "Access a specific notebook from your library by ID. " +
              "Provides detailed metadata about the notebook including topics, use cases, and usage statistics. " +
              "💡 Use the 'id' parameter from list_notebooks to access specific notebooks.",
            mimeType: "application/json",
          },
        ],
      };
    });

    // Read resource content
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      log.info(`📖 [MCP] read_resource request: ${uri}`);

      // Live notebook views (browser-backed)
      if (NOTEBOOK_URI.test(uri)) {
        const data = await this.readNotebookView(uri);
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
        };
      }

      // Handle library resource
      if (uri === "notebooklm://library") {
        const notebooks = this.library.listNotebooks();
        const stats = this.library.getStats();
        const active = this.library.getActiveNotebook();

        const libraryData = {
          active_notebook: active
            ? {
                id: active.id,
                name: active.name,
                description: active.description,
                topics: active.topics,
              }
            : null,
          notebooks: notebooks.map((nb) => ({
            id: nb.id,
            name: nb.name,
            description: nb.description,
            topics: nb.topics,
            content_types: nb.content_types,
            use_cases: nb.use_cases,
            url: nb.url,
            use_count: nb.use_count,
            last_used: nb.last_used,
            tags: nb.tags,
          })),
          stats,
        };

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(libraryData, null, 2),
            },
          ],
        };
      }

      // Handle individual notebook resource
      if (uri.startsWith("notebooklm://library/")) {
        const prefix = "notebooklm://library/";
        const encodedId = uri.slice(prefix.length);
        if (!encodedId) {
          throw new Error("Notebook resource requires an ID (e.g. notebooklm://library/{id})");
        }

        let id: string;
        try {
          id = decodeURIComponent(encodedId);
        } catch {
          throw new Error(`Invalid notebook identifier encoding: ${encodedId}`);
        }

        if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(id)) {
          throw new Error(
            `Invalid notebook identifier: ${encodedId}. Notebook IDs may only contain letters, numbers, and hyphens.`
          );
        }

        const notebook = this.library.getNotebook(id);

        if (!notebook) {
          throw new Error(`Notebook not found: ${id}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(notebook, null, 2),
            },
          ],
        };
      }

      // Legacy metadata resource (backwards compatibility)
      if (uri === "notebooklm://metadata") {
        const active = this.library.getActiveNotebook();

        if (!active) {
          throw new Error("No active notebook. Use notebooklm://library to see all notebooks.");
        }

        const metadata = {
          description: active.description,
          topics: active.topics,
          content_types: active.content_types,
          use_cases: active.use_cases,
          notebook_url: active.url,
          notebook_id: active.id,
          last_used: active.last_used,
          use_count: active.use_count,
          note: "DEPRECATED: Use notebooklm://library or notebooklm://library/{id} instead",
        };

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(metadata, null, 2),
            },
          ],
        };
      }

      // Helpful error so misconfigured clients (issue #15 — reporter requested
      // `mcp://notebooklm`, which never existed) learn the supported URI scheme.
      throw new Error(
        `Unknown resource: ${uri}. Supported URIs: notebooklm://notebook/{uuid}/sources, ` +
          "notebooklm://notebook/{uuid}/studio, notebooklm://library, " +
          "notebooklm://library/{id}, notebooklm://metadata. " +
          "Call resources/list to discover the active set."
      );
    });

    // Argument completions (for prompt arguments and resource templates)
    server.setRequestHandler(CompleteRequestSchema, async (request) => {
      const { ref, argument } = request.params;
      try {
        if (ref.type === "ref/prompt" && this.promptCompleter) {
          return this.buildCompletion(
            this.promptCompleter(ref.name, argument.name, String(argument.value ?? ""))
          );
        }
        if (ref.type === "ref/resource") {
          // The MCP SDK types `ref` as a discriminated union; the resource
          // template branch carries `uri`. Narrow then resolve.
          const uri = ref.uri;
          if (uri === "notebooklm://library/{id}" && argument.name === "id") {
            const values = this.completeNotebookIds(argument.value);
            return this.buildCompletion(values);
          }
          if (
            /^notebooklm:\/\/notebook\/\{notebook\}\//.test(uri) &&
            argument.name === "notebook"
          ) {
            const q = String(argument.value ?? "").toLowerCase();
            const values = this.library
              .listNotebooks()
              .map((n) => notebookUuid(n.url))
              .filter((u): u is string => !!u && u.includes(q))
              .slice(0, 50);
            return this.buildCompletion(values);
          }
        }
      } catch (e) {
        log.warning(`⚠️  [MCP] completion error: ${e}`);
      }
      return { completion: { values: [], total: 0 } };
    });
  }

  /**
   * Return notebook IDs matching the provided input (case-insensitive contains)
   */
  private completeNotebookIds(input: unknown): string[] {
    const query = String(input ?? "").toLowerCase();
    return this.library
      .listNotebooks()
      .map((nb) => nb.id)
      .filter((id) => id.toLowerCase().includes(query))
      .slice(0, 50);
  }

  /**
   * Build a completion payload for MCP responses
   */
  private buildCompletion(values: string[]) {
    return {
      completion: {
        values,
        total: values.length,
      },
    };
  }
}
