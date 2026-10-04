/**
 * Per-request context for MCP tool calls, carried with AsyncLocalStorage so
 * deep browser code can react to the request without threading parameters
 * through every layer:
 *
 *   - `signal`   — aborted when the client sends notifications/cancelled; the
 *                  shared wait helpers (`safeSleep`, `randomDelay`) check it,
 *                  so long polls (answers, uploads, Studio waits) stop promptly
 *   - `progress` — sends notifications/progress when the client asked for it
 *   - `choose`   — asks the user to pick one option (MCP elicitation), used to
 *                  resolve ambiguous names instead of failing
 *   - `sample`   — asks the client's model (MCP sampling), e.g. to propose
 *                  library metadata for a new notebook
 */

import { AsyncLocalStorage } from "async_hooks";

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface RequestContext {
  signal?: AbortSignal;
  progress?: (message: string, progress?: number, total?: number) => Promise<void>;
  /** Resolves to the chosen `value`, or null when the user declined / no UI. */
  choose?: (message: string, options: ChoiceOption[]) => Promise<string | null>;
  /** Ask the client's model (MCP sampling); null when the client has no sampling. */
  sample?: (
    prompt: string,
    opts?: { system?: string; maxTokens?: number }
  ) => Promise<string | null>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function requestContext(): RequestContext | undefined {
  return storage.getStore();
}

export class CancelledError extends Error {
  constructor(message = "Request cancelled by the client") {
    super(message);
    this.name = "CancelledError";
  }
}

/** Throw CancelledError if the current tool call was cancelled. */
export function throwIfCancelled(): void {
  if (storage.getStore()?.signal?.aborted) throw new CancelledError();
}

/**
 * Race a long-running promise (e.g. a multi-minute `waitFor`) against the
 * request's cancellation.
 */
export function abortable<T>(promise: Promise<T>): Promise<T> {
  const signal = storage.getStore()?.signal;
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new CancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/** Report progress for the current tool call; a no-op without a progress token. */
export async function reportProgress(
  message: string,
  progress?: number,
  total?: number
): Promise<void> {
  try {
    await storage.getStore()?.progress?.(message, progress, total);
  } catch {
    /* progress is best-effort */
  }
}
