/**
 * The notebook's chat history: read the whole conversation (for export) and
 * delete it (Notebook menu → "Delete chat history").
 *
 * Reading goes through NotebookLM's data API, like `ask_question` does:
 *   hPTbtc  `[[], null, notebookId, 20]` → the notebook's conversations
 *           `[[[convId, [createdSec, ns], [updatedSec, ns]]]]`
 *   khqZz   `[HEADER, null, null, convId, limit, cursor?]` → the turns,
 *           NEWEST FIRST, `[[turn…], cursor?]`. The web app loads the chat in
 *           pages of 20 as the user scrolls up (lazy loading). When older turns
 *           remain, the response ends with a string cursor that goes in the 6th
 *           slot of the next request; a response without cursor is the oldest
 *           page. `limit` only sets the page size — more turns need the cursor.
 *   rLM1Ne  `[notebookId, null, [2], null, 0]` → the notebook title (`[0][0]`)
 *           and its sources, to name the sources the answers cite.
 *
 * A turn is `[turnId, [sec, ns], kind, questionText?, answer?, …]` with kind 1 =
 * question (text at `[3]`) and kind 2 = answer (`[4][0]` is the streamed
 * answer chunk: `[text, null, ids, null, meta]`). The passages the answer
 * cites sit in `meta`; they are found by shape (`[[id], detail]` entries whose
 * `detail[5][0][0][0]` is a source id) because the answer chunk of a stored
 * turn has one more element than the live stream, which shifts the index.
 *
 * Deleting is `J7Gthc` (DeleteChatTurns): `[HEADER, conversationId, null, 1]` →
 * `[]`, the call the web app sends for "Delete chat history". The conversation
 * stays, empty. It is checked by reading the turns back; if the call fails the
 * menu entry and its confirmation dialog are used instead.
 *
 * Layouts verified live 2026-10 (see also chat-rpc.ts).
 */

import fs from "fs/promises";
import path from "path";
import type { Page } from "patchright";
import { callRpc, RpcError } from "./rpc.js";
import { HEADER, expandCitationRanges } from "./chat-rpc.js";
import { clickVisible } from "./chat-config.js";
import { Selectors } from "./selectors.js";
import { safeSleep } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

/** Turns per request — the page size the web app uses. */
const PAGE_SIZE = 20;
/** Guards against a cursor that never ends. */
const MAX_PAGES = 500;

export interface ChatCitation {
  /** The `[N]` marker in the answer text. */
  number: number;
  /** Title of the cited source. */
  source: string;
  /** The cited passage of that source. */
  excerpt: string;
}

export interface ChatTurn {
  /** 1-based position in the exported conversation, oldest first. */
  n: number;
  role: "user" | "assistant";
  /** ISO 8601 time the turn was stored, or null when it has none. */
  at: string | null;
  /** The question, or the answer with `[N]` citation markers. */
  text: string;
  /** Passages cited by the answer's `[N]` markers (assistant turns, when requested). */
  citations?: ChatCitation[];
}

export interface ChatHistory {
  notebookId: string;
  notebookTitle: string | null;
  /** Null when the notebook has no conversation yet. */
  conversationId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Oldest first. */
  turns: ChatTurn[];
  /** True when older turns were left out (`maxTurns`). */
  truncated: boolean;
}

export interface ReadChatOptions {
  /** Keep only the newest N turns (a question and its answer are two turns). */
  maxTurns?: number;
  /** Attach the cited passages to answers. Default true. */
  includeCitations?: boolean;
}

interface ConversationInfo {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
}

const isoOf = (ts: unknown): string | null => {
  if (!Array.isArray(ts) || typeof ts[0] !== "number") return null;
  const ms = ts[0] * 1000 + Math.floor(Number(ts[1] ?? 0) / 1e6);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

async function listConversations(page: Page, notebookId: string): Promise<ConversationInfo[]> {
  const res = await callRpc<unknown[]>(
    page,
    "hPTbtc",
    [[], null, notebookId, 20],
    `/notebook/${notebookId}`
  );
  const list = Array.isArray(res?.[0]) ? (res[0] as unknown[]) : [];
  return list
    .filter((c): c is unknown[] => Array.isArray(c) && typeof c[0] === "string")
    .map((c) => ({ id: c[0] as string, createdAt: isoOf(c[1]), updatedAt: isoOf(c[2]) }));
}

/**
 * Page through a conversation's turns (newest first) until the oldest page or
 * `maxTurns` is reached. `more` tells whether older turns were left behind.
 */
async function fetchRawTurns(
  page: Page,
  notebookId: string,
  conversationId: string,
  maxTurns?: number
): Promise<{ raw: unknown[][]; more: boolean }> {
  const raw: unknown[][] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let more = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const params: unknown[] = [HEADER, null, null, conversationId, PAGE_SIZE];
    if (cursor) params.push(cursor);
    const res: unknown[] = await callRpc<unknown[]>(
      page,
      "khqZz",
      params,
      `/notebook/${notebookId}`
    );
    const turns = Array.isArray(res?.[0]) ? (res[0] as unknown[][]) : [];
    raw.push(...turns);
    const next: string | null = typeof res?.[1] === "string" ? res[1] : null;
    if (!next) {
      more = false;
      break;
    }
    if (turns.length === 0 || seen.has(next)) {
      log.warning("  ⚠️  Chat history paging did not advance — the history may be incomplete");
      more = true;
      break;
    }
    seen.add(next);
    cursor = next;
    more = true;
    if (maxTurns !== undefined && raw.length >= maxTurns) break;
  }
  return { raw, more };
}

// ---------------------------------------------------------------------------
// Parsing

const isPassage = (p: unknown): p is [unknown[], unknown[]] =>
  Array.isArray(p) && Array.isArray(p[0]) && typeof p[0][0] === "string" && Array.isArray(p[1]);

const sourceIdOf = (detail: unknown[]): string | null => {
  const id = (detail[5] as unknown[][][] | undefined)?.[0]?.[0]?.[0];
  return typeof id === "string" ? id : null;
};

/** The citation passages inside an answer's `meta`, found by shape. */
export function findPassages(meta: unknown): Array<[unknown[], unknown[]]> {
  for (const el of Array.isArray(meta) ? meta : []) {
    if (
      Array.isArray(el) &&
      el.length > 0 &&
      el.every(isPassage) &&
      el.some((p) => sourceIdOf(p[1]) !== null)
    ) {
      return el as Array<[unknown[], unknown[]]>;
    }
  }
  return [];
}

/** The cited text segments of one passage detail (same walk as the live stream). */
export function citedText(detail: unknown): string {
  const parts: string[] = [];
  const segs = Array.isArray(detail) ? (detail as unknown[])[4] : null;
  for (const el of Array.isArray(segs) ? segs : []) {
    if (!Array.isArray(el) || el.length === 0) continue;
    for (const seg of typeof el[0] === "number" ? [el] : el) {
      if (!Array.isArray(seg) || typeof seg[0] !== "number" || !Array.isArray(seg[2])) continue;
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
}

/** Marker numbers (`[3]`) used in an answer, ranges like `[1-3]` expanded. */
function markerNumbers(text: string): Set<number> {
  const used = new Set<number>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) used.add(Number(m[1]));
  return used;
}

export function parseTurn(
  turn: unknown[],
  sourceTitle: (id: string | null) => string,
  includeCitations: boolean
): Omit<ChatTurn, "n"> | null {
  const at = isoOf(turn[1]);
  if (turn[2] === 1 && typeof turn[3] === "string") {
    return { role: "user", at, text: turn[3] };
  }
  if (turn[2] !== 2) return null;
  const chunk = (turn[4] as unknown[] | undefined)?.[0] as unknown[] | undefined;
  const rawText = typeof chunk?.[0] === "string" ? chunk[0] : "";
  const text = expandCitationRanges(rawText);
  const parsed: Omit<ChatTurn, "n"> = { role: "assistant", at, text };
  if (includeCitations) {
    const used = markerNumbers(text);
    const citations = findPassages(chunk?.[4])
      .map(
        ([, detail], i): ChatCitation => ({
          number: i + 1,
          source: sourceTitle(sourceIdOf(detail)),
          excerpt: citedText(detail),
        })
      )
      .filter((c) => used.has(c.number));
    if (citations.length > 0) parsed.citations = citations;
  }
  return parsed;
}

/** Parse raw turns (newest first, as the API returns them) into chronological `ChatTurn`s. */
export function parseTurns(
  raw: unknown[][],
  sourceTitle: (id: string | null) => string,
  includeCitations: boolean
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const t of [...raw].reverse()) {
    const parsed = Array.isArray(t) ? parseTurn(t, sourceTitle, includeCitations) : null;
    if (parsed) turns.push({ n: turns.length + 1, ...parsed });
  }
  return turns;
}

// ---------------------------------------------------------------------------
// Reading

export async function readChatHistory(
  page: Page,
  notebookId: string,
  opts: ReadChatOptions = {}
): Promise<ChatHistory> {
  const includeCitations = opts.includeCitations !== false;
  const sourcePath = `/notebook/${notebookId}`;

  const details = await callRpc<unknown[]>(
    page,
    "rLM1Ne",
    [notebookId, null, [2], null, 0],
    sourcePath
  );
  const head = Array.isArray(details?.[0]) ? (details[0] as unknown[]) : [];
  const notebookTitle = typeof head[0] === "string" ? head[0] : null;
  const titles = new Map<string, string>();
  // An empty notebook answers with null instead of a list.
  for (const s of Array.isArray(head[1]) ? (head[1] as unknown[]) : []) {
    if (Array.isArray(s) && Array.isArray(s[0])) titles.set(String(s[0][0]), String(s[1] ?? ""));
  }
  const sourceTitle = (id: string | null) => (id && titles.get(id)) || "Unknown source";

  const conversations = await listConversations(page, notebookId);
  const conv = conversations[0];
  const empty: ChatHistory = {
    notebookId,
    notebookTitle,
    conversationId: conv?.id ?? null,
    createdAt: conv?.createdAt ?? null,
    updatedAt: conv?.updatedAt ?? null,
    turns: [],
    truncated: false,
  };
  if (!conv) return empty;

  const cap = opts.maxTurns !== undefined && opts.maxTurns > 0 ? opts.maxTurns : undefined;
  const { raw, more } = await fetchRawTurns(page, notebookId, conv.id, cap);
  const kept = cap !== undefined ? raw.slice(0, cap) : raw;
  return {
    ...empty,
    turns: parseTurns(kept, sourceTitle, includeCitations),
    truncated: more || kept.length < raw.length,
  };
}

/** Number of turns in the notebook's conversation (no parsing, no cap). */
export async function countChatTurns(page: Page, notebookId: string): Promise<number> {
  const conv = (await listConversations(page, notebookId))[0];
  if (!conv) return 0;
  return (await fetchRawTurns(page, notebookId, conv.id)).raw.length;
}

// ---------------------------------------------------------------------------
// Formatting + saving

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

export function formatChatHistoryMarkdown(
  h: ChatHistory,
  opts: { exportedAt?: Date; excerptChars?: number } = {}
): string {
  const excerptChars = opts.excerptChars ?? 280;
  const questions = h.turns.filter((t) => t.role === "user").length;
  const lines: string[] = [
    `# Chat history — ${h.notebookTitle ?? h.notebookId}`,
    "",
    `- Notebook: \`${h.notebookId}\``,
    `- Conversation: ${h.conversationId ? `\`${h.conversationId}\`` : "none yet"}`,
    `- Messages: ${h.turns.length} (${questions} questions, ${h.turns.length - questions} answers)`,
    `- Exported: ${stamp((opts.exportedAt ?? new Date()).toISOString())}`,
  ];
  if (h.truncated) lines.push("- Older messages were left out (`max_turns`).");
  for (const t of h.turns) {
    lines.push(
      "",
      `## ${t.n}. ${t.role === "user" ? "Question" : "Answer"}${t.at ? ` — ${stamp(t.at)}` : ""}`,
      ""
    );
    lines.push(t.text.trim());
    if (t.citations?.length) {
      lines.push("", "Sources cited:");
      for (const c of t.citations) {
        const excerpt =
          c.excerpt.length > excerptChars
            ? `${c.excerpt.slice(0, excerptChars).trimEnd()}…`
            : c.excerpt;
        lines.push(`- [${c.number}] ${c.source}${excerpt ? ` — "${excerpt}"` : ""}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatChatHistoryJson(h: ChatHistory): string {
  return `${JSON.stringify(h, null, 2)}\n`;
}

/** File-name-safe, readable slug of a notebook title. */
function slug(text: string): string {
  const s = text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "notebook";
}

/** Save an export; an existing file is never overwritten (` (2)` suffix). */
export async function writeChatHistoryFile(
  h: ChatHistory,
  destinationDir: string,
  format: "markdown" | "json",
  content: string
): Promise<{ filePath: string; bytes: number }> {
  const now = new Date();
  const when = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const ext = format === "json" ? ".json" : ".md";
  const name = `chat-history-${slug(h.notebookTitle ?? h.notebookId)}-${when}${ext}`;
  await fs.mkdir(destinationDir, { recursive: true });
  let filePath = path.join(destinationDir, name);
  for (
    let n = 2;
    await fs.stat(filePath).then(
      () => true,
      () => false
    );
    n++
  ) {
    filePath = path.join(destinationDir, name.replace(/(\.[^.]+)$/, ` (${n})$1`));
  }
  const body = Buffer.from(content, "utf8");
  await fs.writeFile(filePath, body);
  return { filePath, bytes: body.length };
}

export interface ChatHistoryExport {
  notebook_id: string;
  notebook_title: string | null;
  conversation_id: string | null;
  messages: number;
  questions: number;
  /** True when older messages were left out (`max_turns`). */
  truncated: boolean;
  first_at: string | null;
  last_at: string | null;
  format: "markdown" | "json";
  /** Set when saved to `destination_dir`. */
  file_path?: string;
  bytes?: number;
  /** The Markdown document (format "markdown", nothing saved). */
  markdown?: string;
  /** The structured history (format "json", nothing saved). */
  history?: ChatHistory;
}

/** Render a history as Markdown or JSON and either save it or hand it back inline. */
export async function exportChatHistory(
  h: ChatHistory,
  format: "markdown" | "json",
  destinationDir?: string
): Promise<ChatHistoryExport> {
  const summary: ChatHistoryExport = {
    notebook_id: h.notebookId,
    notebook_title: h.notebookTitle,
    conversation_id: h.conversationId,
    messages: h.turns.length,
    questions: h.turns.filter((t) => t.role === "user").length,
    truncated: h.truncated,
    first_at: h.turns[0]?.at ?? null,
    last_at: h.turns[h.turns.length - 1]?.at ?? null,
    format,
  };
  const content = format === "json" ? formatChatHistoryJson(h) : formatChatHistoryMarkdown(h);
  if (destinationDir) {
    const saved = await writeChatHistoryFile(h, destinationDir, format, content);
    log.success(`  ✅ Chat history saved: ${saved.filePath} (${saved.bytes} bytes)`);
    return { ...summary, file_path: saved.filePath, bytes: saved.bytes };
  }
  return format === "json" ? { ...summary, history: h } : { ...summary, markdown: content };
}

// ---------------------------------------------------------------------------
// Deleting

export interface ChatHistoryTarget {
  conversationId: string;
  title: string;
  messages: number;
  lastQuestion: string | null;
}

/** What a delete would remove, without changing anything (for the approval prompt). */
export async function resolveChatHistoryTarget(
  page: Page,
  notebookId: string
): Promise<ChatHistoryTarget> {
  const h = await readChatHistory(page, notebookId, { includeCitations: false });
  if (!h.conversationId || h.turns.length === 0) {
    throw new Error("This notebook has no chat history to delete.");
  }
  const last = [...h.turns].reverse().find((t) => t.role === "user");
  return {
    conversationId: h.conversationId,
    title: h.notebookTitle ?? notebookId,
    messages: h.turns.length,
    lastQuestion: last ? last.text.trim().slice(0, 120) : null,
  };
}

export interface DeleteChatHistoryResult {
  deleted_messages: number;
}

/** DeleteChatTurns — what the web app calls for "Delete chat history". */
const DELETE_CHAT_RPC = "J7Gthc";

/**
 * Delete the chat history over the data API and read it back. Throws a plain
 * Error for an empty chat and an RpcError when the call fails or the history is
 * still there afterwards (the caller then falls back to the menu). Callers must
 * have the user's approval — this cannot be undone.
 */
export async function deleteChatHistoryRpc(
  page: Page,
  notebookId: string,
  /** How long to wait for the history to disappear. */
  waitMs = 10_000
): Promise<DeleteChatHistoryResult> {
  const conv = (await listConversations(page, notebookId))[0];
  const before = conv ? await countChatTurns(page, notebookId) : 0;
  if (!conv || before === 0) throw new Error("This notebook has no chat history to delete.");

  await callRpc(page, DELETE_CHAT_RPC, [HEADER, conv.id, null, 1], `/notebook/${notebookId}`);

  const deadline = Date.now() + waitMs;
  do {
    if ((await countChatTurns(page, notebookId)) === 0) {
      log.success(`  🗑️  Chat history deleted (${before} messages)`);
      return { deleted_messages: before };
    }
    await safeSleep(page, 400);
  } while (Date.now() < deadline);
  throw new RpcError("the chat history is still listed after the delete call", DELETE_CHAT_RPC);
}

/**
 * Notebook menu → "Delete chat history" → confirm. The page must show the chat
 * (the menu entry is disabled for an empty one). Verified over RPC afterwards:
 * only an empty conversation counts as success. Callers must have the user's
 * approval — this cannot be undone.
 */
export async function deleteChatHistoryOnPage(
  page: Page,
  notebookId: string
): Promise<DeleteChatHistoryResult> {
  const before = await countChatTurns(page, notebookId);
  if (before === 0) throw new Error("This notebook has no chat history to delete.");

  await clickVisible(page, Selectors.settings.notebookMenuButton, "notebook menu button");
  const item = page.locator(Selectors.deletion.chatHistoryMenuItem.join(", ")).first();
  await item.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (!(await item.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(
      'Could not find the "Delete chat history" menu entry — NotebookLM UI may have changed.'
    );
  }
  if (await item.isDisabled().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(
      '"Delete chat history" is disabled — the tab does not show the chat yet. Reload the notebook and retry.'
    );
  }
  await item.click();

  const dialog = page.locator("mat-dialog-container").last();
  await dialog.waitFor({ state: "visible", timeout: 6_000 }).catch(() => undefined);
  const outcome = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("mat-dialog-container"));
    const d = dialogs[dialogs.length - 1];
    if (!d) return "no-dialog";
    // Only confirm the chat-history dialog, never some other dialog that is in the way.
    if (!/chat|history/i.test(d.textContent ?? "")) return "unexpected-dialog";
    const enabled = Array.from(d.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => !b.disabled
    );
    const btn = d.querySelector<HTMLButtonElement>("button.mat-tonal-button") ?? enabled.pop();
    if (!btn || btn.disabled) return "no-button";
    btn.click();
    return "clicked";
  });
  if (outcome !== "clicked") {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(
      outcome === "unexpected-dialog"
        ? "An unexpected dialog appeared instead of the chat history confirmation; nothing was deleted."
        : 'Could not find the confirmation dialog of "Delete chat history" — NotebookLM UI may have changed.'
    );
  }
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await countChatTurns(page, notebookId)) === 0) {
      log.success(`  🗑️  Chat history deleted (${before} messages)`);
      return { deleted_messages: before };
    }
    await safeSleep(page, 700);
  }
  throw new Error(
    "The deletion was confirmed, but NotebookLM still lists the chat history — it may not have been deleted."
  );
}
