/**
 * Direct calls to NotebookLM's internal `batchexecute` RPC API.
 *
 * The web app talks to `POST /_/LabsTailwindUi/data/batchexecute` with
 * `f.req=[[[rpcId, JSON(params), null, "generic"]]]` plus the page's CSRF
 * token (`at`, WIZ key `SNlM0e`), session id (`f.sid`, `FdrFJe`) and build
 * label (`bl`, `cfb2h`). The response is `)]}'`-prefixed, length-framed JSON;
 * the result is the `["wrb.fr", rpcId, "<json>", …, error]` chunk.
 *
 * Calls run inside the signed-in notebook tab (`fetch` from the page), so the
 * browser sends its own — device-bound — cookies; nothing is copied out of the
 * profile. Reading data this way does not click anything in the UI, so it is
 * faster and does not break when the layout changes.
 *
 * RPC ids and payload/response layouts follow gemini-notebook-mcp-cli
 * (https://github.com/jacob-bd/gemini-notebook-mcp-cli, MIT License,
 * Copyright (c) 2025 Jacob Ben David) and were verified live in 2026-10.
 * Google may rotate them; a changed id surfaces as RpcError.
 */

import type { Page } from "patchright";

export const RPC = {
  listNotebooks: "wXbhsf",
  /** Studio library: `[[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"']`. */
  listArtifacts: "gArtLc",
  /** One artifact incl. the interactive HTML of quizzes, flashcards, mind maps: `[artifactId]`. */
  getArtifact: "v9rmvd",
} as const;

/**
 * False when NOTEBOOKLM_USE_RPC=false: operations that have a UI path use it
 * instead (a kill switch should Google change the protocol).
 */
export function rpcEnabled(): boolean {
  return process.env.NOTEBOOKLM_USE_RPC?.toLowerCase() !== "false";
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly rpcId: string,
    readonly code: number | null = null
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** Call one RPC from inside `page` (must be a signed-in NotebookLM page). */
export async function callRpc<T = unknown>(
  page: Page,
  rpcId: string,
  params: unknown,
  sourcePath: string
): Promise<T> {
  const res = await page.evaluate(
    async ({ rpcId, params, sourcePath }) => {
      // The stealth browser evaluates in an isolated world, so read the WIZ
      // tokens from the page source instead of window.WIZ_global_data.
      const html = document.documentElement.innerHTML;
      const pick = (key: string) =>
        html.match(new RegExp(`"${key}":"([^"]+)"`))?.[1]?.replace(/\\u003d/g, "=") ?? "";
      const at = pick("SNlM0e");
      if (!at) return { status: 0, error: "no CSRF token on the page (not signed in?)" };
      const fReq = JSON.stringify([[[rpcId, JSON.stringify(params), null, "generic"]]]);
      const query = new URLSearchParams({
        rpcids: rpcId,
        "source-path": sourcePath,
        bl: pick("cfb2h"),
        "f.sid": pick("FdrFJe"),
        hl: "en",
        rt: "c",
      });
      const response = await fetch(`/_/LabsTailwindUi/data/batchexecute?${query}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Same-Domain": "1",
        },
        body: `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(at)}&`,
      });
      return { status: response.status, text: await response.text() };
    },
    { rpcId, params, sourcePath }
  );

  if ("error" in res) throw new RpcError(String(res.error), rpcId);
  if (res.status === 401 || res.status === 403) {
    throw new RpcError(
      `HTTP ${res.status} — the Google session needs a fresh login (setup_auth)`,
      rpcId
    );
  }
  if (res.status >= 400) throw new RpcError(`HTTP ${res.status}`, rpcId);
  return extractResult<T>(res.text ?? "", rpcId);
}

/** Pull the `wrb.fr` result for `rpcId` out of a batchexecute response body. */
export function extractResult<T>(body: string, rpcId: string): T {
  for (const line of body.replace(/^\)\]\}'/, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue; // length markers and blanks
    let chunk: unknown;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;
    for (const item of chunk) {
      if (!Array.isArray(item) || item[0] !== "wrb.fr" || item[1] !== rpcId) continue;
      const error = item[5];
      if (Array.isArray(error) && typeof error[0] === "number") {
        const code = error[0];
        throw new RpcError(
          code === 16
            ? "authentication expired — run setup_auth"
            : `RPC ${rpcId} failed with code ${code}`,
          rpcId,
          code
        );
      }
      if (typeof item[2] !== "string") return null as T;
      return JSON.parse(item[2]) as T;
    }
  }
  throw new RpcError(`no result for ${rpcId} in the response (RPC id rotated?)`, rpcId);
}
