/**
 * Studio library items over the RPC API (see rpc.ts): the "View prompt and
 * sources" panel and Rename from an item's menu.
 *
 * Stored artifacts keep the creation request's layout (see studio-rpc.ts):
 * [0] id · [1] title · [2] type code · [3] [[[sourceId], …]…] · [4] status ·
 * [15] created [sec, ns], and the type's options at the same index as when
 * generating — verified live 2026-10:
 *   audio [6][1] = [prompt, length, null, …, lang@4]
 *   report [7][1] = [template title, description, null, [[id]…], lang, prompt]
 *   video [8][2] = [[[id]…], lang, prompt, …]
 *   interactive (quiz, flashcards, mind map) [9][1] = [format, ?, prompt, lang]
 *   infographic [14][0] = [prompt, lang, …] · slide deck [16][0] = [prompt, lang, …]
 *   rc3d8d  ← [[artifactId, title], [["title"]]] → artifact (renamed)
 */

import type { Page } from "patchright";
import { callRpc } from "./rpc.js";
import { artifactType, isReady, listRawArtifacts, type Raw } from "./studio-download.js";

const RPC_UPDATE_ARTIFACT = "rc3d8d";

const at = (v: unknown, ...path: number[]): unknown =>
  path.reduce<unknown>((cur, i) => (Array.isArray(cur) ? cur[i] : undefined), v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Where each type code keeps its prompt and language. */
const PROMPT_PATHS: Record<number, { prompt: number[]; language: number[] }> = {
  1: { prompt: [6, 1, 0], language: [6, 1, 4] },
  2: { prompt: [7, 1, 5], language: [7, 1, 4] },
  3: { prompt: [8, 2, 2], language: [8, 2, 1] },
  4: { prompt: [9, 1, 2], language: [9, 1, 3] },
  7: { prompt: [14, 0, 0], language: [14, 0, 1] },
  8: { prompt: [16, 0, 0], language: [16, 0, 1] },
  11: { prompt: [7, 1, 5], language: [7, 1, 4] },
};

export interface StudioItemDetails {
  id: string;
  title: string;
  type: string;
  status: "ready" | "generating";
  /** The instructions the item was generated with (null = none given). */
  prompt: string | null;
  language: string | null;
  /** Report template ("Study Guide", "Custom Report", …) — reports only. */
  template: string | null;
  sourceIds: string[];
  createdAt: string | null;
}

function details(a: Raw): StudioItemDetails {
  const paths = PROMPT_PATHS[Number(a[2])];
  const sources = Array.isArray(a[3]) ? a[3] : [];
  const created = at(a, 15, 0);
  return {
    id: a[0] as string,
    title: String(a[1] ?? ""),
    type: artifactType(a),
    status: isReady(a) ? "ready" : "generating",
    prompt: paths ? str(at(a, ...paths.prompt)) : null,
    language: paths ? str(at(a, ...paths.language)) : null,
    template: Number(a[2]) === 2 ? str(at(a, 7, 1, 0)) : null,
    sourceIds: sources.map((s) => at(s, 0, 0)).filter((v): v is string => typeof v === "string"),
    createdAt: typeof created === "number" ? new Date(created * 1000).toISOString() : null,
  };
}

/**
 * Find one Studio item by id (or unique id prefix) or title (exact, then
 * unique substring, case-insensitive).
 */
export async function findStudioItem(
  page: Page,
  notebookId: string,
  ref: string
): Promise<StudioItemDetails> {
  const all = (await listRawArtifacts(page, notebookId)).map(details);
  const q = ref.trim().toLowerCase();
  let hits = all.filter((d) => d.id.toLowerCase().startsWith(q));
  if (hits.length === 0) hits = all.filter((d) => d.title.toLowerCase() === q);
  if (hits.length === 0) hits = all.filter((d) => d.title.toLowerCase().includes(q));
  if (hits.length !== 1) {
    const list = (hits.length ? hits : all).map((d) => `${d.type} "${d.title}" (${d.id})`);
    throw new Error(
      `${hits.length ? "Several" : "No"} Studio items match "${ref}". ` +
        `${hits.length ? "Candidates" : "Items"}: ${list.join("; ") || "none"}`
    );
  }
  return hits[0];
}

/** Rename a Studio item; returns the title NotebookLM stored. */
export async function renameStudioItemRpc(
  page: Page,
  notebookId: string,
  artifactId: string,
  title: string
): Promise<string> {
  const res = await callRpc<unknown[]>(
    page,
    RPC_UPDATE_ARTIFACT,
    [[artifactId, title], [["title"]]],
    `/notebook/${notebookId}`
  );
  const saved = at(res, 1);
  if (saved !== title) {
    throw new Error(`Rename was not applied (asked "${title}", got "${String(saved)}").`);
  }
  return saved;
}
