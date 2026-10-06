/**
 * Source inspection and source discovery over the RPC API (see rpc.ts).
 *
 * Inspection — what a source really contains, for source criticism:
 *   rLM1Ne  → [[title, [src…], …]]; src = [[id], title, meta, [null, status]]
 *             meta[1] words · meta[2] added [sec, ns] · meta[4] type ·
 *             meta[5] YouTube [url, videoId, channel] · meta[6] 1 added | 2 via research ·
 *             meta[7] [url] · meta[8] characters · meta[9] Drive file tuple · meta[19] MIME
 *   hizoJc  ← [[id], [2], [2]] → [srcEntry, null, null, [[block…]]] — the indexed text
 *   tr032e  ← [[[[id]]]] → [[[[id]], [summary], [[keyword…]]]] — NotebookLM's source guide
 *
 * Discovery — the "Search the web for new sources" box (Fast / Deep Research):
 *   Ljjv0c  ← [[query, corpus], null, 1, notebookId]          fast (web 1 | Drive 2) → [taskId]
 *   QA9ei   ← [null, [1], [query, 1], 5, notebookId]          deep (web only)        → [taskId]
 *   e3bVqc  ← [null, null, notebookId] → [[[taskId, [nbId, [query, corpus], mode, [cands, summary], status, …], …]…]]
 *             status 1 running · 2 done · 3 failed (no result) · 6 done and (partly)
 *             imported; mode 1 fast · 5 deep
 *             fast candidate: [url, title, description, type, …, imported?]
 *             deep candidate: [url, title, description?, type, null, null,
 *                              [null, 1 cited | 2 consulted, supporting passage], null, citation#]
 *             the deep report is the type-5 entry: [null, title, null, 5, null, null, [markdown]]
 *   LBwxtb  ← [null, [1], taskId, notebookId, [[null, null, [url, title], null ×7, 2]…]]
 *             → [[[[id], title, meta, [null, status]]…]]
 *
 * Layouts after gemini-notebook-mcp-cli (MIT, Copyright (c) 2025 Jacob Ben
 * David), verified live 2026-10.
 */

import type { Page } from "patchright";
import { callRpc, RpcError } from "./rpc.js";
import { notebookSourceList } from "./rpc-ops.js";

const RPC_NOTEBOOK = "rLM1Ne";
const RPC_SOURCE_TEXT = "hizoJc";
const RPC_SOURCE_GUIDE = "tr032e";
const RPC_FAST_RESEARCH = "Ljjv0c";
const RPC_DEEP_RESEARCH = "QA9ei";
const RPC_POLL_RESEARCH = "e3bVqc";
const RPC_IMPORT_RESEARCH = "LBwxtb";
const RPC_RENAME_SOURCE = "b7Wfje";

/**
 * Rename a source (`b7Wfje` ← [null, [id], [[[title]]]] → [[[id], title, …]]);
 * returns the title NotebookLM stored.
 */
export async function renameSourceRpc(
  page: Page,
  notebookId: string,
  sourceId: string,
  title: string
): Promise<string> {
  const res = await callRpc<unknown[]>(
    page,
    RPC_RENAME_SOURCE,
    [null, [sourceId], [[[title]]]],
    `/notebook/${notebookId}`
  );
  const saved = at(res, 0, 1);
  if (saved !== title) {
    throw new Error(`Source rename was not applied (asked "${title}", got "${String(saved)}").`);
  }
  return saved;
}

const at = (v: unknown, ...path: number[]): unknown =>
  path.reduce<unknown>((cur, i) => (Array.isArray(cur) ? cur[i] : undefined), v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const isoFromSeconds = (v: unknown): string | null =>
  typeof at(v, 0) === "number" ? new Date((at(v, 0) as number) * 1000).toISOString() : null;

// ---------------------------------------------------------------------------
// Source inspection

const SOURCE_TYPES: Record<number, string> = {
  1: "google_doc",
  2: "google_slides_sheets",
  3: "pdf",
  4: "text",
  5: "web",
  8: "markdown",
  9: "youtube",
  10: "audio",
  11: "file",
  13: "image",
  14: "word_doc",
};
const STATUS: Record<number, SourceDetails["status"]> = {
  1: "processing",
  2: "ready",
  3: "failed",
  5: "processing",
};

export interface SourceDetails {
  id: string;
  title: string;
  /** web, youtube, pdf, text, markdown, google_doc, word_doc, audio, image … */
  type: string;
  url: string | null;
  /** YouTube channel, when the source is a video. */
  channel: string | null;
  words: number | null;
  characters: number | null;
  status: "ready" | "processing" | "failed";
  /** `research` when it came in through Fast / Deep Research. */
  origin: "added" | "research";
  addedAt: string | null;
  mimeType: string | null;
  /** Google Drive file id for Drive-backed sources. */
  driveId: string | null;
}

function parseSource(src: unknown[]): SourceDetails {
  const meta = (Array.isArray(src[2]) ? src[2] : []) as unknown[];
  const typeCode = num(meta[4]);
  const mime = str(meta[19]) ?? str(at(meta, 9, 2));
  let type = typeCode !== null ? (SOURCE_TYPES[typeCode] ?? `type_${typeCode}`) : "unknown";
  if (type === "word_doc" && mime === "application/pdf") type = "pdf";
  const youtube = Array.isArray(meta[5]) ? (meta[5] as unknown[]) : null;
  return {
    id: String(at(src, 0, 0)),
    title: str(src[1]) ?? "Untitled",
    type,
    url: str(at(meta, 7, 0)) ?? (youtube ? str(youtube[0]) : null),
    channel: youtube ? str(youtube[2]) : null,
    words: num(meta[1]),
    characters: num(meta[8]),
    status: STATUS[Number(at(src, 3, 1) ?? 2)] ?? "ready",
    origin: meta[6] === 2 ? "research" : "added",
    addedAt: isoFromSeconds(meta[2]),
    mimeType: mime,
    driveId: str(at(meta, 0, 0)) ?? str(at(meta, 9, 0)),
  };
}

/** Every source of the notebook with type, URL, size, status and origin. */
export async function listSourceDetailsRpc(
  page: Page,
  notebookId: string
): Promise<SourceDetails[]> {
  const res = await callRpc<unknown[]>(
    page,
    RPC_NOTEBOOK,
    [notebookId, null, [2], null, 0],
    `/notebook/${notebookId}`
  );
  return notebookSourceList(res)
    .filter((s): s is unknown[] => Array.isArray(s) && typeof at(s, 0, 0) === "string")
    .map(parseSource);
}

/** NotebookLM's own summary and keyword chips for one source. */
export async function getSourceGuideRpc(
  page: Page,
  sourceId: string
): Promise<{ summary: string | null; keywords: string[] }> {
  const res = await callRpc<unknown[]>(page, RPC_SOURCE_GUIDE, [[[[sourceId]]]], "/");
  const entry = at(res, 0, 0);
  if (!Array.isArray(entry))
    throw new RpcError("unexpected source guide response", RPC_SOURCE_GUIDE);
  const keywords = at(entry, 2, 0);
  return {
    summary: str(at(entry, 1, 0)),
    keywords: Array.isArray(keywords)
      ? keywords.filter((k): k is string => typeof k === "string")
      : [],
  };
}

/**
 * The text NotebookLM indexed for a source — what answers are grounded on,
 * which is not always what the page shows (cookie banners, navigation, a
 * repository landing page instead of the paper).
 */
export async function getSourceTextRpc(page: Page, sourceId: string): Promise<string> {
  const res = await callRpc<unknown[]>(page, RPC_SOURCE_TEXT, [[sourceId], [2], [2]], "/");
  // Blocks are wrapped once or twice (`[[[block…]]]`): unwrap to the list
  // whose entries start with a [start, end] offset pair.
  let blocks = at(res, 3);
  while (Array.isArray(blocks) && Array.isArray(blocks[0]) && typeof blocks[0][0] !== "number") {
    blocks = blocks[0];
  }
  if (!Array.isArray(blocks))
    throw new RpcError("unexpected source text response", RPC_SOURCE_TEXT);
  // Each block is [start, end, [[[start, end, [text, …]] …]], …]: text runs
  // are the strings at position 0 of the innermost arrays.
  const paragraphs: string[] = [];
  for (const block of blocks) {
    const runs: string[] = [];
    collectRuns(at(block, 2), runs);
    const text = runs.join("").trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

function collectRuns(node: unknown, out: string[]): void {
  if (!Array.isArray(node)) return;
  // A run: [start:number, end:number, [text:string, …]]
  if (typeof node[0] === "number" && typeof node[1] === "number" && Array.isArray(node[2])) {
    const inner = node[2] as unknown[];
    if (typeof inner[0] === "string") {
      out.push(inner[0]);
      return;
    }
    collectRuns(inner, out);
    return;
  }
  for (const child of node) collectRuns(child, out);
}

// ---------------------------------------------------------------------------
// Source discovery (Fast / Deep Research)

export type ResearchCorpus = "web" | "drive";
export type ResearchMode = "fast" | "deep";

const CANDIDATE_TYPES: Record<number, string> = {
  1: "web",
  2: "google_doc",
  3: "google_slides",
  5: "deep_report",
  6: "drive_pdf",
  7: "drive_word",
  8: "google_sheets",
};

export interface ResearchCandidate {
  index: number;
  url: string | null;
  title: string;
  description: string | null;
  /** web, or a Drive file: google_doc, google_slides, google_sheets, drive_pdf, drive_word. */
  type: string;
  /** Already imported into the notebook. */
  imported: boolean;
  /** Deep research: the report cites it (`citation` is its number there). */
  cited?: boolean;
  citation?: number | null;
  /** Deep research: the passage the report drew from it. */
  passage?: string | null;
}

export interface ResearchTask {
  taskId: string;
  query: string;
  corpus: ResearchCorpus;
  mode: ResearchMode;
  status: "running" | "completed" | "failed";
  /** Fast research: a one-line description of what was found. */
  summary: string | null;
  /** Deep research: the report's title and Markdown text. */
  reportTitle: string | null;
  report: string | null;
  candidates: ResearchCandidate[];
  startedAt: string | null;
}

function parseCandidate(raw: unknown, index: number, deep: boolean): ResearchCandidate | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const typeCode = num(raw[3]);
  if (typeCode === 5) return null; // the deep report itself
  const candidate: ResearchCandidate = {
    index,
    url: str(raw[0]),
    title: str(raw[1]) ?? "Untitled",
    description: str(raw[2]),
    type: typeCode !== null ? (CANDIDATE_TYPES[typeCode] ?? `type_${typeCode}`) : "web",
    imported: raw[7] === true,
  };
  if (deep) {
    candidate.cited = at(raw, 6, 1) === 1;
    candidate.citation = num(raw[8]);
    candidate.passage = str(at(raw, 6, 2));
  }
  return candidate;
}

function parseTask(raw: unknown): ResearchTask | null {
  if (!Array.isArray(raw) || typeof raw[0] !== "string") return null;
  const info = raw[1];
  if (!Array.isArray(info)) return null;
  const found = at(info, 3);
  const raws = at(found, 0);
  const rawCandidates = Array.isArray(raws) ? raws : [];
  const deep = info[2] === 5;
  // Drive results list each file twice (different descriptions): keep the first.
  const seen = new Set<string>();
  const candidates = rawCandidates
    .map((c, i) => parseCandidate(c, i, deep))
    .filter((c): c is ResearchCandidate => c !== null)
    .filter((c) => !c.url || (!seen.has(c.url) && seen.add(c.url) !== undefined));
  const reportEntry = rawCandidates.find((c) => at(c, 3) === 5);
  const status = num(info[4]);
  return {
    taskId: raw[0],
    query: str(at(info, 1, 0)) ?? "",
    corpus: at(info, 1, 1) === 2 ? "drive" : "web",
    mode: info[2] === 5 ? "deep" : "fast",
    status: status === 2 || status === 6 ? "completed" : status === 3 ? "failed" : "running",
    summary: str(at(found, 1)),
    reportTitle: str(at(reportEntry, 1)),
    report: str(at(reportEntry, 6, 0)),
    candidates,
    startedAt: isoFromSeconds(raw[3]),
  };
}

/** Research runs of the notebook, newest first. */
export async function listResearchRpc(page: Page, notebookId: string): Promise<ResearchTask[]> {
  const res = await callRpc<unknown[]>(
    page,
    RPC_POLL_RESEARCH,
    [null, null, notebookId],
    `/notebook/${notebookId}`
  );
  if (res === null || (Array.isArray(res) && res.length === 0)) return [];
  const rows = Array.isArray(at(res, 0, 0)) ? (res[0] as unknown[]) : res;
  if (!Array.isArray(rows)) throw new RpcError("unexpected research response", RPC_POLL_RESEARCH);
  return rows.map(parseTask).filter((t): t is ResearchTask => t !== null);
}

/** Start a Fast (web or Drive) or Deep (web) research run; returns its task id. */
export async function startResearchRpc(
  page: Page,
  notebookId: string,
  query: string,
  corpus: ResearchCorpus,
  mode: ResearchMode
): Promise<string> {
  const corpusCode = corpus === "drive" ? 2 : 1;
  const res =
    mode === "deep"
      ? await callRpc<unknown[]>(
          page,
          RPC_DEEP_RESEARCH,
          [null, [1], [query, corpusCode], 5, notebookId],
          `/notebook/${notebookId}`
        )
      : await callRpc<unknown[]>(
          page,
          RPC_FAST_RESEARCH,
          [[query, corpusCode], null, 1, notebookId],
          `/notebook/${notebookId}`
        );
  const taskId = str(at(res, 0));
  if (!taskId) throw new RpcError("research start returned no task id", RPC_FAST_RESEARCH);
  return taskId;
}

/**
 * Import chosen candidates of a finished research run. Web candidates go in
 * by URL; Drive candidates by their Drive document id.
 */
export async function importResearchRpc(
  page: Page,
  notebookId: string,
  taskId: string,
  candidates: ResearchCandidate[]
): Promise<Array<{ id: string; title: string }>> {
  const mime: Record<string, string> = {
    google_doc: "application/vnd.google-apps.document",
    google_slides: "application/vnd.google-apps.presentation",
    google_sheets: "application/vnd.google-apps.spreadsheet",
    drive_pdf: "application/pdf",
    drive_word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  const entries = candidates.map((c) => {
    const driveId = c.type in mime ? c.url?.match(/[?&]id=([^&]+)/)?.[1] : undefined;
    return driveId
      ? [
          [driveId, mime[c.type], 1, c.title],
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          2,
        ]
      : [null, null, [c.url, c.title], null, null, null, null, null, null, null, 2];
  });
  const res = await callRpc<unknown[]>(
    page,
    RPC_IMPORT_RESEARCH,
    [null, [1], taskId, notebookId, entries],
    `/notebook/${notebookId}`
  );
  const rows = Array.isArray(at(res, 0, 0)) ? (res[0] as unknown[]) : res;
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ id: str(at(r, 0, 0)), title: str(at(r, 1)) ?? "Untitled" }))
    .filter((r): r is { id: string; title: string } => r.id !== null);
}
