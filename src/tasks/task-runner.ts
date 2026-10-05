/**
 * MCP tasks (experimental, spec 2025-11-25): "call now, fetch later" for the
 * long-running tools. A tools/call with `params.task` returns a task at once;
 * the tool runs in the background under its own AbortSignal (tasks/cancel),
 * reports status messages through the task store, and stores the final
 * CallToolResult for tasks/result.
 *
 * For Studio generation the task completes only when the output is actually
 * ready in the Studio library (or immediately when it was queued with
 * "Generate later"), replacing the generate → poll status → download chain.
 */

import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import {
  CancelTaskRequestSchema,
  ErrorCode,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  McpError,
  type CallToolRequest,
  type CallToolResult,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CancelledError,
  runWithRequestContext,
  type RequestContext,
} from "../utils/request-context.js";
import { log } from "../utils/logger.js";

/** Tools that may run as tasks (`execution.taskSupport: "optional"`). */
export const TASK_TOOLS = new Set([
  "ask_question",
  "add_source",
  "generate_audio",
  "generate_studio_artifact",
  "download_audio",
  "download_studio_artifact",
  "save_answer_as_note",
  "convert_note_to_source",
]);

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_TTL_MS = 60 * 60_000;
const STUDIO_POLL_MS = 20_000;
const STUDIO_TIMEOUT_MS = 30 * 60_000;

type ToolRunner = (
  name: string,
  args: Record<string, unknown> | undefined,
  progress: (message: string) => Promise<void>
) => Promise<CallToolResult>;

type StudioLister = (
  args: Record<string, unknown> | undefined
) => Promise<Array<{ id: string; type: string; title: string; status: string }> | null>;

export class TaskRunner {
  private store = new InMemoryTaskStore();
  private runs = new Map<string, AbortController>();

  constructor(
    private runTool: ToolRunner,
    private listStudio: StudioLister,
    /** Elicitation / sampling helpers carried into the background run. */
    private helpers: Pick<RequestContext, "choose" | "sample">
  ) {}

  /** Start a task for a tools/call that carried `params.task`. */
  async start(
    request: CallToolRequest,
    requestId: RequestId,
    sessionId: string | undefined
  ): Promise<{ task: Awaited<ReturnType<InMemoryTaskStore["createTask"]>> }> {
    const { name, arguments: args } = request.params;
    if (!TASK_TOOLS.has(name)) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${name} does not support task execution.`);
    }
    const ttl = request.params.task?.ttl ?? DEFAULT_TTL_MS;
    const task = await this.store.createTask(
      { ttl, pollInterval: 5_000 },
      requestId,
      request,
      sessionId
    );
    const controller = new AbortController();
    this.runs.set(task.taskId, controller);
    log.info(`🧵 [MCP] task ${task.taskId} started for ${name}`);

    const status = (message: string) =>
      this.store
        .updateTaskStatus(task.taskId, "working", message, sessionId)
        .catch(() => undefined);

    void runWithRequestContext({ ...this.helpers, signal: controller.signal }, async () => {
      try {
        const before = isStudio(name) ? await this.listStudio(args).catch(() => null) : null;
        let result = await this.runTool(name, args, status);
        if (!result.isError && isStudio(name) && before) {
          result = await this.awaitStudioOutput(
            name,
            args,
            result,
            before,
            status,
            controller.signal
          );
        }
        await this.store.storeTaskResult(
          task.taskId,
          result.isError ? "failed" : "completed",
          result,
          sessionId
        );
        log.info(`🧵 [MCP] task ${task.taskId} ${result.isError ? "failed" : "completed"}`);
      } catch (error) {
        if (error instanceof CancelledError || controller.signal.aborted) {
          await this.store
            .updateTaskStatus(task.taskId, "cancelled", "Cancelled by the client.", sessionId)
            .catch(() => undefined);
        } else {
          const message = error instanceof Error ? error.message : String(error);
          await this.store
            .storeTaskResult(
              task.taskId,
              "failed",
              {
                content: [
                  { type: "text", text: JSON.stringify({ success: false, error: message }) },
                ],
                isError: true,
              },
              sessionId
            )
            .catch(() => undefined);
        }
      } finally {
        this.runs.delete(task.taskId);
      }
    });
    return { task };
  }

  /**
   * After a Studio job was started, wait until a new library item of that
   * kind is `ready`. Jobs queued with "Generate later" (`scheduled`) finish
   * immediately — they may take hours.
   */
  private async awaitStudioOutput(
    name: string,
    args: Record<string, unknown> | undefined,
    started: CallToolResult,
    before: Array<{ id: string }>,
    status: (m: string) => Promise<unknown>,
    signal: AbortSignal
  ): Promise<CallToolResult> {
    const startedData = started.structuredContent as
      | { data?: { result?: { status?: string } } }
      | undefined;
    const startStatus = startedData?.data?.result?.status;
    if (startStatus !== "started" && startStatus !== "in_progress") return started;
    const known = new Set(before.map((b) => b.id));
    const type = name === "generate_audio" ? "audio" : String(args?.type ?? "");
    const deadline = Date.now() + STUDIO_TIMEOUT_MS;
    const t0 = Date.now();
    while (Date.now() < deadline) {
      await sleep(STUDIO_POLL_MS, signal);
      const items = (await this.listStudio(args).catch(() => null)) ?? [];
      const fresh = items.filter((i) => !known.has(i.id) && (!type || i.type === type));
      const ready = fresh.find((i) => i.status === "ready");
      if (ready) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, data: { result: { status: "ready", artifact: ready } } },
                null,
                2
              ),
            },
          ],
          structuredContent: {
            success: true,
            data: { result: { status: "ready", artifact: ready } },
          },
        };
      }
      await status(
        `Generating ${type || "Studio output"} (${Math.round((Date.now() - t0) / 60_000)} min elapsed)…`
      );
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: false, error: "Studio output not ready after 30 min." }),
        },
      ],
      isError: true,
    };
  }

  register(server: Server): void {
    server.setRequestHandler(GetTaskRequestSchema, async (request, extra) => {
      const task = await this.store.getTask(request.params.taskId, extra.sessionId);
      if (!task)
        throw new McpError(ErrorCode.InvalidParams, `Task ${request.params.taskId} not found`);
      return task;
    });

    // tasks/result blocks until the task reaches a terminal state.
    server.setRequestHandler(GetTaskPayloadRequestSchema, async (request, extra) => {
      const { taskId } = request.params;
      for (;;) {
        const task = await this.store.getTask(taskId, extra.sessionId);
        if (!task) throw new McpError(ErrorCode.InvalidParams, `Task ${taskId} not found`);
        if (task.status === "cancelled") {
          throw new McpError(ErrorCode.InvalidRequest, `Task ${taskId} was cancelled`);
        }
        if (TERMINAL.has(task.status)) return this.store.getTaskResult(taskId, extra.sessionId);
        await sleep(1_000, extra.signal);
      }
    });

    server.setRequestHandler(CancelTaskRequestSchema, async (request, extra) => {
      const { taskId } = request.params;
      const task = await this.store.getTask(taskId, extra.sessionId);
      if (!task) throw new McpError(ErrorCode.InvalidParams, `Task ${taskId} not found`);
      if (TERMINAL.has(task.status)) {
        throw new McpError(ErrorCode.InvalidParams, `Task ${taskId} is already ${task.status}`);
      }
      this.runs.get(taskId)?.abort();
      await this.store.updateTaskStatus(
        taskId,
        "cancelled",
        "Cancelled by the client.",
        extra.sessionId
      );
      log.info(`🧵 [MCP] task ${taskId} cancelled`);
      return (await this.store.getTask(taskId, extra.sessionId))!;
    });

    server.setRequestHandler(ListTasksRequestSchema, async (request, extra) =>
      this.store.listTasks(request.params?.cursor, extra.sessionId)
    );
  }

  shutdown(): void {
    for (const c of this.runs.values()) c.abort();
    this.store.cleanup();
  }
}

function isStudio(name: string): boolean {
  return name === "generate_studio_artifact" || name === "generate_audio";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
