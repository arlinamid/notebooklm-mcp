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
