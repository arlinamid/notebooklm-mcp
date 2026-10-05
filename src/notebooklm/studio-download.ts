/**
 * Download any Studio output through the RPC API (see rpc.ts) instead of the
 * UI menus: the Studio library RPC (`gArtLc`) carries the media URLs of audio,
 * video, infographics and slide decks and the content of reports and data
 * tables; quizzes, flashcards and mind maps come from `v9rmvd` (interactive
 * HTML with the data in `data-app-data`).
 *
 * Raw artifact layout (array indices), after gemini-notebook-mcp-cli
 * (MIT, Copyright (c) 2025 Jacob Ben David), verified live 2026-10:
 *   [0] id · [1] title · [2] type code · [4] status (3 = ready)
 *   audio [6][5] media list · video [8] media list · report [7][0] markdown
 *   interactive format [9][1][0] (1 flashcards, 2 quiz, 4 mind map)
 *   infographic [14][2][0][1][0] · slide deck [16][3] PDF, [16][4] PPTX
 *   data table [18] cells · data table export [24][3] XLSX
 *
 * resolveStudioDownload only reads — the caller fetches media URLs and writes
 * files, outside the page lock.
 */

import type { Page } from "patchright";
import { callRpc, RPC } from "./rpc.js";

const TYPE_CODES: Record<number, string> = {
  1: "audio",
  2: "report",
  3: "video",
  4: "interactive",
  7: "infographic",
  8: "slide_deck",
  9: "data_table",
  10: "data_table",
  11: "report",
};
const INTERACTIVE_FORMATS: Record<number, string> = { 1: "flashcards", 2: "quiz", 4: "mind_map" };
const READY = 3;

export type StudioDownloadFormat = "pdf" | "pptx" | "markdown" | "json" | "html";

export interface StudioDownloadTarget {
  id: string;
  title: string;
  type: string;
}

export type StudioDownloadPlan = { artifact: StudioDownloadTarget; ext: string } & (
  | { kind: "url"; url: string }
  | { kind: "text"; content: string }
);

type Raw = unknown[];
const at = (v: unknown, ...path: number[]): unknown =>
  path.reduce<unknown>((cur, i) => (Array.isArray(cur) ? cur[i] : undefined), v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Our type name for a raw artifact (`quiz`, `mind_map`, … for interactive ones). */
export function artifactType(a: Raw): string {
  const base = TYPE_CODES[Number(a[2])] ?? "unknown";
  if (base !== "interactive") return base;
  return INTERACTIVE_FORMATS[Number(at(a, 9, 1, 0))] ?? "unknown";
}

function isReady(a: Raw): boolean {
  if (a[4] === READY) return true;
  // Some finished audio reports status 2 while already exposing media URLs.
  return a[2] === 1 && a[4] === 2 && Array.isArray(at(a, 6, 5));
}

/**
 * Pick the artifact (by id, unique id prefix, or newest ready one of `type`)
 * and work out what to save: a media URL to fetch, or text content.
 */
export async function resolveStudioDownload(
  page: Page,
  notebookId: string,
  want: { artifactId?: string; type?: string; format?: StudioDownloadFormat }
): Promise<StudioDownloadPlan> {
  const path = `/notebook/${notebookId}`;
  const result = await callRpc<unknown[]>(
    page,
    RPC.listArtifacts,
    [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'],
    path
  );
  const all = ((Array.isArray(result?.[0]) ? result[0] : result) ?? []).filter(
    (a): a is Raw => Array.isArray(a) && typeof a[0] === "string"
  );
  const describe = (a: Raw) => `${artifactType(a)} "${String(a[1])}" (${String(a[0])})`;

  let target: Raw | undefined;
  if (want.artifactId) {
    const id = want.artifactId.trim().toLowerCase();
    const hits = all.filter((a) => (a[0] as string).toLowerCase().startsWith(id));
    if (hits.length !== 1) {
      throw new Error(
        `${hits.length ? "Ambiguous" : "No"} Studio item for id "${want.artifactId}". ` +
          `Items: ${all.map(describe).join("; ") || "none"}`
      );
    }
    target = hits[0];
  } else if (want.type) {
    target = all.find((a) => artifactType(a) === want.type && isReady(a));
    if (!target) {
      throw new Error(
        `No finished ${want.type} in this notebook. Items: ${all.map(describe).join("; ") || "none"}`
      );
    }
  } else {
    throw new Error("Pass `artifact_id` (from list_studio_artifacts) or `type`.");
  }
  if (!isReady(target)) throw new Error(`${describe(target)} is not finished yet.`);

  const artifact = {
    id: target[0] as string,
    title: String(target[1] ?? ""),
    type: artifactType(target),
  };
  const url = (u: string | null, ext: string, what: string): StudioDownloadPlan => {
    if (!u) throw new Error(`No ${what} URL in the ${artifact.type} metadata (layout changed?).`);
    return { artifact, kind: "url", url: u, ext };
  };
  const text = (content: string, ext: string): StudioDownloadPlan => ({
    artifact,
    kind: "text",
    content,
    ext,
  });

  switch (artifact.type) {
    case "audio":
      return url(pickMedia(at(target, 6, 5), "audio/mp4"), "m4a", "audio");
    case "video":
      return url(pickMedia(findMediaList(target[8]), "video/mp4"), "mp4", "video");
    case "infographic":
      return url(str(at(target, 14, 2, 0, 1, 0)), "png", "image");
    case "slide_deck":
      return want.format === "pptx"
        ? url(str(at(target, 16, 4)), "pptx", "PPTX")
        : url(str(at(target, 16, 3)), "pdf", "PDF");
    case "report": {
      if (target[2] === 11) {
        throw new Error(
          "Interactive reports cannot be exported as a file yet — use Export to Docs in NotebookLM."
        );
      }
      const md = str(at(target, 7, 0)) ?? str(target[7]);
      if (!md) throw new Error("The report has no content yet.");
      return text(md, "md");
    }
    case "data_table":
      if (target[2] === 10) return url(str(at(target, 24, 3)), "xlsx", "XLSX");
      return text(dataTableCsv(target[18]), "csv");
    case "quiz":
    case "flashcards":
    case "mind_map": {
      const res = await callRpc<unknown[]>(page, RPC.getArtifact, [artifact.id], path);
      const html = str(at(res, 0, 9, 0));
      if (!html) throw new Error(`No content for ${describe(target)}.`);
      if (want.format === "html") return text(html, "html");
      const data = appData(html);
      if (artifact.type === "mind_map") return text(JSON.stringify(data, null, 2), "json");
      if (want.format === "json") return text(JSON.stringify(data, null, 2), "json");
      return text(
        artifact.type === "quiz"
          ? quizMarkdown(artifact.title, data.quiz)
          : flashcardsMarkdown(artifact.title, data.flashcards),
        "md"
      );
    }
    default:
      throw new Error(`Downloading ${describe(target)} is not supported.`);
  }
}

/** Prefer the download variant (priority 4) of `mime`, then any `mime`, then the first URL. */
function pickMedia(list: unknown, mime: string): string | null {
  if (!Array.isArray(list)) return null;
  const items = list.filter((i): i is unknown[] => Array.isArray(i) && typeof i[0] === "string");
  const typed = items.filter((i) => i[2] === mime);
  return (typed.find((i) => i[1] === 4) ?? typed[0] ?? items[0])?.[0] as string | null;
}

function findMediaList(meta: unknown): unknown {
  if (!Array.isArray(meta)) return null;
  return meta.find(
    (m) => typeof at(m, 0, 0) === "string" && String(at(m, 0, 0)).startsWith("http")
  );
}

/** Text of a data-table cell: nested arrays mixing position numbers and strings. */
function cellText(cell: unknown, depth = 0): string {
  if (depth > 100 || cell === null || cell === undefined || typeof cell === "number") return "";
  if (typeof cell === "string") return cell.trim();
  if (Array.isArray(cell)) {
    return cell
      .map((c) => cellText(c, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  return String(cell).trim();
}

/** Rows live at raw[0][0][0][0][4][2], each `[start, end, [cells…]]`; row 0 is the header. */
function dataTableCsv(raw: unknown): string {
  const rows = at(raw, 0, 0, 0, 0, 4, 2);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("The data table has no rows.");
  const table = rows
    .map((r) => at(r, 2))
    .filter(Array.isArray)
    .map((cells) => (cells as unknown[]).map((c) => cellText(c)));
  const width = table[0].length;
  const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return (
    "﻿" +
    table
      .map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")].slice(0, width))
      .map((r) => r.map(quote).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

/** JSON embedded in the interactive HTML (`data-app-data="…"`, HTML-escaped). */
function appData(html: string): Record<string, unknown> & { quiz?: unknown; flashcards?: unknown } {
  const m = html.match(/data-app-data="([^"]*)"/);
  if (!m) throw new Error("Could not find the data in the interactive content.");
  const decoded = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded);
}

function quizMarkdown(title: string, questions: unknown): string {
  const lines = [`# ${title}`, ""];
  (Array.isArray(questions) ? questions : []).forEach((q, i) => {
    lines.push(`## ${i + 1}. ${q?.question ?? ""}`, "");
    for (const o of q?.answerOptions ?? [])
      lines.push(`- [${o?.isCorrect ? "x" : " "}] ${o?.text ?? ""}`);
    if (q?.hint) lines.push("", `**Hint:** ${q.hint}`);
    lines.push("");
  });
  return lines.join("\n");
}

function flashcardsMarkdown(title: string, cards: unknown): string {
  const lines = [`# ${title}`, ""];
  (Array.isArray(cards) ? cards : []).forEach((c, i) => {
    lines.push(
      `## ${i + 1}`,
      "",
      `**Front:** ${c?.f ?? ""}`,
      "",
      `**Back:** ${c?.b ?? ""}`,
      "",
      "---",
      ""
    );
  });
  return lines.join("\n");
}

/** A safe file name from the artifact title. */
export function studioFileName(artifact: StudioDownloadTarget, ext: string): string {
  const base =
    artifact.title
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100)
      .replace(/[. ]+$/, "") || `${artifact.type}-${artifact.id.slice(0, 8)}`;
  return `${base}.${ext}`;
}
