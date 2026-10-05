/**
 * Ask through NotebookLM's streamed query endpoint instead of typing into the
 * chat box and watching the DOM for the answer.
 *
 *   POST /_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.
 *        LabsTailwindOrchestrationService/GenerateFreeFormStreamed
 *   f.req = [null, JSON([[[[srcId]]]…, question, history | null, [2, null, [1]], convId])]
 *
 * The notebook's server-side conversation (`hPTbtc`) is continued, with its
 * turns (`khqZz`) sent as history like the web app does, so follow-ups keep
 * their context and the Q&A shows up in NotebookLM's own chat. Scoping to
 * `sources` sends only those ids — the notebook's checkbox selection is never
 * touched.
 *
 * The stream (often megabytes of cumulative chunks) is parsed inside the page;
 * only the final answer and its passages cross into Node. Each answer chunk is
 * `[[text, null, [convId, …], null, [segments, null, null, passages, 1]]]`
 * (type 2 = thinking); passage i (citation i + 1) carries its source id at
 * `[1][5][0][0][0]` and the cited text segments at `[1][4]`.
 *
 * Layouts after gemini-notebook-mcp-cli (MIT, Copyright (c) 2025 Jacob Ben
 * David), verified live 2026-10.
 */

import { randomUUID } from "crypto";
import type { Page } from "patchright";
import { callRpc, RpcError } from "./rpc.js";
import { resolveSourceIds } from "./source-select.js";
import type { Citation } from "./citations.js";

const QUERY_PATH =
  "/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1." +
  "LabsTailwindOrchestrationService/GenerateFreeFormStreamed";
const HEADER = [2, null, [1], [1, null, null, null, null, null, null, null, null, null, [1, 3]]];
/** Turns of history sent along (each Q and each A counts as one). */
const HISTORY_TURNS = 20;

export interface RpcAnswer {
  /** Markdown answer with `[N]` citation markers. */
  answer: string;
  citations: Citation[];
  /** Titles the answer was scoped to, or null for all sources. */
  scopedTo: string[] | null;
}

export async function askRpc(
  page: Page,
  notebookId: string,
  question: string,
  sources?: string[]
): Promise<RpcAnswer> {
  const path = `/notebook/${notebookId}`;
  const details = await callRpc<unknown[]>(page, "rLM1Ne", [notebookId, null, [2], null, 0], path);
  const raw = (details?.[0] as unknown[] | undefined)?.[1];
  if (!Array.isArray(raw)) throw new RpcError("unexpected notebook response", "rLM1Ne");
  const items = raw
    .filter((s): s is unknown[] => Array.isArray(s) && Array.isArray(s[0]))
    .map((s) => ({ id: String((s[0] as unknown[])[0]), title: String(s[1] ?? "") }));
  if (items.length === 0) throw new Error("This notebook has no sources.");
  const ids = sources?.length
    ? [...(await resolveSourceIds(items, sources))]
    : items.map((i) => i.id);

  const conv = await callRpc<unknown[]>(page, "hPTbtc", [[], null, notebookId, 20], path);
  const convId = firstString(conv) ?? randomUUID();
  const history: unknown[] = [];
  if (firstString(conv)) {
    const turns = await callRpc<unknown[]>(
      page,
      "khqZz",
      [HEADER, null, null, convId, HISTORY_TURNS],
      path
    );
    for (const t of [...((turns?.[0] as unknown[][] | undefined) ?? [])].reverse()) {
      if (t?.[2] === 1 && typeof t[3] === "string") history.push([t[3], null, 1]);
      else if (t?.[2] === 2) history.push([String((t[4] as unknown[][])?.[0]?.[0] ?? ""), null, 2]);
    }
  }

  const params = [
    ids.map((id) => [[id]]),
    question,
    history.length ? history : null,
    [2, null, [1]],
    convId,
  ];
  const res = await page.evaluate(
    async ({ url, params }) => {
      const html = document.documentElement.innerHTML;
      const pick = (k: string) =>
        html.match(new RegExp(`"${k}":"([^"]+)"`))?.[1]?.replace(/\\u003d/g, "=") ?? "";
      const at = pick("SNlM0e");
      if (!at) return { status: 0, fatal: "no CSRF token on the page (not signed in?)" };
      const query = new URLSearchParams({
        bl: pick("cfb2h"),
        hl: "en",
        _reqid: String(100000 + Math.floor(Math.random() * 900000)),
        rt: "c",
        "f.sid": pick("FdrFJe"),
      });
      const fReq = JSON.stringify([null, JSON.stringify(params)]);
      const response = await fetch(`${url}?${query}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Same-Domain": "1",
        },
        body: `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(at)}&`,
      });
      const body = await response.text();

      type Passage = { sourceId: string | null; text: string };
      const citedText = (detail: unknown): string => {
        const parts: string[] = [];
        const segs = Array.isArray(detail) ? (detail as unknown[])[4] : null;
        for (const el of Array.isArray(segs) ? segs : []) {
          if (!Array.isArray(el) || el.length === 0) continue;
          for (const seg of typeof el[0] === "number" ? [el] : el) {
            if (!Array.isArray(seg) || typeof seg[0] !== "number" || !Array.isArray(seg[2]))
              continue;
            for (const group of seg[2] as unknown[]) {
              for (const inner of Array.isArray(group) ? group : []) {
                const t = Array.isArray(inner) ? inner[2] : null;
                if (typeof t === "string" && t.trim()) parts.push(t.trim());
                else if (Array.isArray(t))
                  for (const s of t) if (typeof s === "string" && s.trim()) parts.push(s.trim());
              }
            }
          }
        }
        return parts.join(" ");
      };

      let best: { text: string; passages: Passage[] } | null = null;
      let error: number | null = null;
      for (const line of body.replace(/^\)\]\}'/, "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("[")) continue;
        let chunk: unknown;
        try {
          chunk = JSON.parse(trimmed);
        } catch {
          continue;
        }
        for (const item of Array.isArray(chunk) ? chunk : []) {
          if (!Array.isArray(item) || item[0] !== "wrb.fr") continue;
          if (typeof item[2] !== "string") {
            if (Array.isArray(item[5]) && typeof item[5][0] === "number") error = item[5][0];
            continue;
          }
          let inner: unknown;
          try {
            inner = JSON.parse(item[2]);
          } catch {
            continue;
          }
          const first = Array.isArray(inner) ? inner[0] : null;
          if (!Array.isArray(first) || typeof first[0] !== "string") continue;
          const meta = Array.isArray(first[4]) ? first[4] : null;
          if (!meta || meta[meta.length - 1] !== 1) continue; // 2 = thinking
          if (best && first[0].length < best.text.length) continue;
          const passages = (Array.isArray(meta[3]) ? meta[3] : []).map((p: unknown) => {
            const detail = Array.isArray(p) ? p[1] : null;
            const ref = Array.isArray(detail) ? detail[5] : null;
            const sid = Array.isArray(ref) ? ref?.[0]?.[0]?.[0] : null;
            return { sourceId: typeof sid === "string" ? sid : null, text: citedText(detail) };
          });
          best = { text: first[0], passages };
        }
      }
      return { status: response.status, best, error };
    },
    { url: QUERY_PATH, params }
  );

  if ("fatal" in res) throw new RpcError(String(res.fatal), "query");
  if (res.status === 401 || res.status === 403) {
    throw new RpcError(
      `HTTP ${res.status} — the Google session needs a fresh login (setup_auth)`,
      "query"
    );
  }
  if (res.status >= 400) throw new RpcError(`HTTP ${res.status}`, "query");
  if (!res.best) {
    throw new RpcError(
      res.error !== null ? `query rejected with code ${res.error}` : "no answer in the response",
      "query",
      res.error
    );
  }

  const title = (id: string | null) => items.find((i) => i.id === id)?.title ?? "Unknown source";
  const citations: Citation[] = res.best.passages.map((p, i) => ({
    marker: `[${i + 1}]`,
    number: i + 1,
    sourceName: title(p.sourceId),
    sourceText: p.text || title(p.sourceId),
  }));
  return {
    answer: expandCitationRanges(res.best.text),
    citations,
    scopedTo: sources?.length ? items.filter((i) => ids.includes(i.id)).map((i) => i.title) : null,
  };
}

/** "[1-3]" → "[1][2][3]", "[1, 4]" → "[1][4]" (the formatters work per marker). */
export function expandCitationRanges(text: string): string {
  return text.replace(/\[(\d+(?:\s*[-–,]\s*\d+)+)\]/g, (whole, body: string) => {
    const numbers: number[] = [];
    for (const part of body.split(",")) {
      const [a, b] = part.split(/[-–]/).map((n) => Number(n.trim()));
      if (!Number.isInteger(a)) return whole;
      if (b === undefined) numbers.push(a);
      else if (Number.isInteger(b) && b >= a && b - a < 50)
        for (let n = a; n <= b; n++) numbers.push(n);
      else return whole;
    }
    return numbers.map((n) => `[${n}]`).join("");
  });
}

function firstString(v: unknown): string | null {
  let cur = v;
  for (let i = 0; i < 4 && Array.isArray(cur); i++) cur = cur[0];
  return typeof cur === "string" ? cur : null;
}
