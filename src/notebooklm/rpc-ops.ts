/**
 * Notebook-level operations over the RPC API (see rpc.ts) that used to open
 * menus and dialogs: usage windows, chat configuration, the account's notebook
 * list. Callers fall back to the UI path when these throw RpcError (an id
 * Google rotated), so a protocol change degrades to the old behaviour.
 *
 * Layouts after gemini-notebook-mcp-cli (MIT, Copyright (c) 2025 Jacob Ben
 * David), verified live 2026-10:
 *   EylDcb  → [?, [[…, window(1 rolling | 2 weekly), [resetSec, ns], used%, left%], …]]
 *   rLM1Ne  → [[title, sources, id, emoji, null, meta, null, chatSettings, …]]
 *   s0tc2d  ← [id, [[null ×7, [[goal, prompt?], [length]]]]] → notebook (same layout)
 *   wXbhsf  → [[[title, sources, id, emoji, null, meta], …]]; meta[0] 1 = owned,
 *             meta[8] = created [sec, ns]
 *   izAoDd  ← [[sourceData…], id, [2], settings] → [[[[sourceId], title, meta, [null, status]]…]]
 *   tGMBJ / V5N4be are not used: deletions stay on the server-acknowledged UI path
 *   chat goal 1 default · 2 custom · 3 learning guide; length 1 default · 4 longer · 5 shorter
 */

import type { Page } from "patchright";
import { callRpc, RpcError } from "./rpc.js";
import type { UsageInfo } from "./usage.js";
import type { ChatConfigInput, ChatConfigResult, ChatGoal, ChatLength } from "./chat-config.js";
import type { AccountNotebook, AccountNotebookScope } from "./account-notebooks.js";
import { NOTEBOOKLM_BASE_URL } from "../config.js";

const RPC_USAGE = "EylDcb";
const RPC_NOTEBOOK = "rLM1Ne";
const RPC_UPDATE_NOTEBOOK = "s0tc2d";
const RPC_LIST_NOTEBOOKS = "wXbhsf";

const USAGE_HEADER = [
  2,
  null,
  [1],
  [1, null, null, null, null, null, null, null, null, null, [1, 3]],
];
const WINDOW_LABELS: Record<number, string> = {
  1: "Current Gemini Notebook AI usage",
  2: "Weekly limit",
};

const GOALS: Record<number, ChatGoal> = { 1: "default", 2: "custom", 3: "learning_guide" };
const GOAL_CODES: Record<ChatGoal, number> = { default: 1, custom: 2, learning_guide: 3 };
const LENGTHS: Record<number, ChatLength> = { 1: "default", 4: "longer", 5: "shorter" };
const LENGTH_CODES: Record<ChatLength, number> = { default: 1, longer: 4, shorter: 5 };

const at = (v: unknown, ...path: number[]): unknown =>
  path.reduce<unknown>((cur, i) => (Array.isArray(cur) ? cur[i] : undefined), v);
const isoFromSeconds = (v: unknown): string | null =>
  typeof at(v, 0) === "number" ? new Date((at(v, 0) as number) * 1000).toISOString() : null;

/** Usage windows (rolling + weekly) — no Settings dialog. `resets` is ISO time. */
export async function readUsageRpc(page: Page, sourcePath: string): Promise<UsageInfo> {
  const result = await callRpc<unknown[]>(page, RPC_USAGE, [USAGE_HEADER], sourcePath);
  const entries = (at(result, 1) as unknown[] | undefined) ?? [];
  const windows = entries
    .filter((e): e is unknown[] => Array.isArray(e) && e.length >= 8)
    .map((e) => ({
      type: Number(e[4]),
      label: WINDOW_LABELS[Number(e[4])] ?? `Usage window ${String(e[4])}`,
      percentUsed: Math.round(Number(e[6] ?? 0) * 10) / 10,
      resets: isoFromSeconds(e[5]),
    }))
    .sort((a, b) => a.type - b.type)
    .map(({ label, percentUsed, resets }) => ({ label, percentUsed, resets }));
  if (windows.length === 0) throw new Error("Usage RPC returned no windows.");
  return { windows, raw: JSON.stringify(result) };
}

function parseChatSettings(settings: unknown): Omit<ChatConfigResult, "saved"> {
  const prompt = at(settings, 0, 1);
  return {
    goal: GOALS[Number(at(settings, 0, 0))] ?? "unknown",
    length: LENGTHS[Number(at(settings, 1, 0))] ?? "unknown",
    customPrompt: typeof prompt === "string" && prompt ? prompt : null,
  };
}

/**
 * Read — and, when `input` asks for changes, write — the chat configuration.
 * Unspecified fields keep their current value, like the dialog does.
 */
export async function configureChatRpc(
  page: Page,
  notebookId: string,
  input: ChatConfigInput
): Promise<ChatConfigResult> {
  const path = `/notebook/${notebookId}`;
  const details = await callRpc<unknown[]>(
    page,
    RPC_NOTEBOOK,
    [notebookId, null, [2], null, 0],
    path
  );
  const current = parseChatSettings(at(details, 0, 7));

  const goal: ChatGoal =
    input.goal ??
    (input.customPrompt !== undefined
      ? "custom"
      : current.goal === "unknown"
        ? "default"
        : current.goal);
  const length: ChatLength =
    input.length ?? (current.length === "unknown" ? "default" : current.length);
  const prompt = input.customPrompt ?? current.customPrompt ?? null;
  const unchanged =
    goal === current.goal &&
    length === current.length &&
    (goal !== "custom" || prompt === current.customPrompt);
  if (unchanged) return { ...current, saved: false };

  if (goal === "custom" && !prompt?.trim()) {
    throw new Error('goal "custom" needs a `custom_prompt`.');
  }
  if (prompt && prompt.length > 10_000) {
    throw new Error(`custom_prompt is ${prompt.length} chars; the limit is 10 000.`);
  }
  const goalSetting = goal === "custom" ? [GOAL_CODES.custom, prompt] : [GOAL_CODES[goal]];
  const updated = await callRpc<unknown[]>(
    page,
    RPC_UPDATE_NOTEBOOK,
    [
      notebookId,
      [[null, null, null, null, null, null, null, [goalSetting, [LENGTH_CODES[length]]]]],
    ],
    path
  );
  const saved = parseChatSettings(at(updated, 7));
  if (saved.goal !== goal || saved.length !== length) {
    throw new Error(
      `Chat settings were not applied (asked ${goal}/${length}, got ${saved.goal}/${saved.length}).`
    );
  }
  return { ...saved, saved: true };
}

/** The signed-in account's notebooks in one call (any NotebookLM page). */
export async function listAccountNotebooksRpc(
  page: Page,
  scopes: AccountNotebookScope[]
): Promise<AccountNotebook[]> {
  const result = await callRpc<unknown[]>(page, RPC_LIST_NOTEBOOKS, [null, 1, null, [2]], "/");
  // An unexpected shape must not read as "no notebooks" — let the caller fall back.
  if (!Array.isArray(at(result, 0))) {
    throw new RpcError("unexpected notebook list response", RPC_LIST_NOTEBOOKS);
  }
  const list = (result[0] as unknown[]).filter(
    (n): n is unknown[] => Array.isArray(n) && typeof n[2] === "string"
  );
  return list
    .map((n): AccountNotebook => {
      const uuid = (n[2] as string).toLowerCase();
      return {
        uuid,
        url: new URL(`/notebook/${uuid}`, NOTEBOOKLM_BASE_URL).toString(),
        title: typeof n[0] === "string" && n[0].trim() ? n[0].trim() : "Untitled notebook",
        emoji: typeof n[3] === "string" && n[3] ? n[3] : null,
        sources: Array.isArray(n[1]) ? n[1].length : 0,
        created_at: isoFromSeconds(at(n, 5, 8)),
        scope: at(n, 5, 0) === 1 ? "mine" : "shared",
        public: at(n, 5, 1) === true,
      };
    })
    .filter((nb) => scopes.includes(nb.scope));
}

// ---------------------------------------------------------------------------
// Sources

const RPC_ADD_SOURCE = "izAoDd";
const RPC_ADD_SOURCE_V2 = "ozz5Z";
const ADD_SETTINGS = [1, null, null, null, null, null, null, null, null, null, [1]];
/** rLM1Ne source status (`src[3][1]`): 1 processing · 2 ready · 3 error · 5 preparing. */
const SOURCE_READY = 2;
const SOURCE_FAILED = 3;

export interface RpcSourceAddResult {
  ids: string[];
  titles: string[];
  before: number;
  after: number;
  /** Sources still processing when the wait ended (usable once ready). */
  pending: string[];
  failed: string[];
}

type RawSource = unknown[];

async function listRawSources(page: Page, notebookId: string): Promise<RawSource[]> {
  const res = await callRpc<unknown[]>(
    page,
    RPC_NOTEBOOK,
    [notebookId, null, [2], null, 0],
    `/notebook/${notebookId}`
  );
  const list = at(res, 0, 1);
  if (!Array.isArray(list)) throw new RpcError("unexpected notebook response", RPC_NOTEBOOK);
  return list.filter((s): s is RawSource => Array.isArray(s) && typeof at(s, 0, 0) === "string");
}

const sourceId = (s: RawSource) => at(s, 0, 0) as string;
const sourceStatus = (s: RawSource) => Number(at(s, 3, 1) ?? SOURCE_READY);

/**
 * Add pasted text, web URLs or YouTube URLs as sources, then wait (up to
 * `waitMs`) until NotebookLM has processed them. An ambiguous reply (codes 3
 * and 9 can mean "accepted, still processing") is reconciled against the
 * notebook before anything is retried, so a source is never added twice.
 */
export async function addSourcesRpc(
  page: Page,
  notebookId: string,
  input: { type: "text" | "url" | "youtube"; content: string; title?: string },
  waitMs = 90_000
): Promise<RpcSourceAddResult> {
  const path = `/notebook/${notebookId}`;
  const before = await listRawSources(page, notebookId);
  const known = new Set(before.map(sourceId));

  const urls = input.content.split(/\s+/).filter(Boolean);
  const entries =
    input.type === "text"
      ? [
          [
            null,
            [input.title?.trim() || "Pasted text", input.content],
            null,
            2,
            null,
            null,
            null,
            null,
            null,
            null,
            1,
          ],
        ]
      : urls.map((url) =>
          input.type === "youtube" || /youtube\.com|youtu\.be/i.test(url)
            ? [null, null, null, null, null, null, null, [url], null, null, 1]
            : [null, null, [url], null, null, null, null, null, null, null, 1]
        );
  if (entries.length === 0) throw new Error(`\`content\` is required for type "${input.type}".`);

  let ids: string[] = [];
  try {
    const res = await callRpc<unknown[]>(
      page,
      RPC_ADD_SOURCE,
      [entries, notebookId, [2], ADD_SETTINGS],
      path
    );
    ids = ((at(res, 0) as unknown[]) ?? [])
      .map((s) => at(s, 0, 0))
      .filter((v): v is string => typeof v === "string");
  } catch (error) {
    if (!(error instanceof RpcError) || (error.code !== 3 && error.code !== 9)) throw error;
    ids = await newSourceIds(page, notebookId, known, entries.length);
    if (ids.length === 0 && input.type !== "text") {
      // The legacy endpoint really rejected it; accounts on the newer one take URLs here.
      await callRpc(
        page,
        RPC_ADD_SOURCE_V2,
        [
          urls.map((u) => [
            [null, u, 627],
            [null, null, null, null, null, null, null, null, null, [null, null, 1]],
            1,
          ]),
        ],
        path
      ).catch(() => undefined);
    }
    if (ids.length === 0) ids = await newSourceIds(page, notebookId, known, entries.length);
    if (ids.length === 0) throw error;
  }
  if (ids.length === 0) ids = await newSourceIds(page, notebookId, known, entries.length);
  if (ids.length === 0) throw new RpcError("source add returned no id", RPC_ADD_SOURCE);

  // Wait for processing (web pages and videos take a while).
  const deadline = Date.now() + waitMs;
  let current = await listRawSources(page, notebookId);
  for (;;) {
    const mine = current.filter((s) => ids.includes(sourceId(s)));
    const busy = mine.filter((s) => ![SOURCE_READY, SOURCE_FAILED].includes(sourceStatus(s)));
    if (busy.length === 0 || Date.now() > deadline) {
      return {
        ids,
        titles: mine.map((s) => String(s[1] ?? "")),
        before: before.length,
        after: current.length,
        pending: busy.map(sourceId),
        failed: mine.filter((s) => sourceStatus(s) === SOURCE_FAILED).map(sourceId),
      };
    }
    await page.waitForTimeout(2_000);
    current = await listRawSources(page, notebookId);
  }
}

/** Ids of sources that appeared since `known` (polls briefly for late arrivals). */
async function newSourceIds(
  page: Page,
  notebookId: string,
  known: Set<string>,
  expected: number
): Promise<string[]> {
  for (let i = 0; i < 6; i++) {
    const fresh = (await listRawSources(page, notebookId))
      .map(sourceId)
      .filter((id) => !known.has(id));
    if (fresh.length >= expected || (i >= 3 && fresh.length > 0)) return fresh;
    await page.waitForTimeout(1_500);
  }
  return [];
}
