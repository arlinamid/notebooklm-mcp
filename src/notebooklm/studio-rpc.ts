/**
 * Start Studio generations through the RPC API (`R7cb6c`) instead of the
 * customise dialogs — for the types whose payloads are verified: audio,
 * video, infographic and slide deck. Everything else (reports, flashcards,
 * quizzes, data tables, mind maps, "Generate later", options without a known
 * code, no explicit language) returns null and the caller uses the dialog.
 *
 * Language: the given one (code, own name or English name), else the
 * account's output-language override. With neither ("Default" — output in
 * the UI language, English for this server) the dialog is used, so the
 * result matches what the user would get in NotebookLM itself.
 *
 * Payload layouts after gemini-notebook-mcp-cli (MIT, Copyright (c) 2025
 * Jacob Ben David):
 *   params = [[2], notebookId, content]; content[2] = type code,
 *   content[3] = [[[sourceId]], …], options at a per-type index:
 *   audio [6] = [null, [prompt, length, null, [[id]…], lang, null, format]]
 *   video [8] = [null, null, [[[id]…], lang, prompt, null, format, style?]]
 *   infographic [14] = [[prompt, lang, null, orientation, detail, style]]
 *   slide deck [16] = [[prompt, lang, format, length]]
 *   → [[artifactId, title, type, …]]
 */

import type { Page } from "patchright";
import { callRpc, RpcError } from "./rpc.js";
import { resolveSourceIds } from "./source-select.js";
import type { GenerateStudioOptions, GenerateStudioResult } from "./studio.js";
import { resolveLanguage } from "./language.js";
import { getOutputLanguageRpc } from "./rpc-ops.js";

const RPC_CREATE = "R7cb6c";
const RPC_NOTEBOOK = "rLM1Ne";

const TYPE_CODES = { audio: 1, video: 3, infographic: 7, slide_deck: 8 } as const;

const CODES: Record<string, Record<string, Record<string, number>>> = {
  audio: {
    format: { deep_dive: 1, brief: 2, critique: 3, debate: 4 },
    length: { short: 1, default: 2, long: 3 },
  },
  video: { format: { explainer: 1, cinematic: 3, short: 4 } },
  infographic: {
    orientation: { landscape: 1, portrait: 2, square: 3 },
    detail: { concise: 1, standard: 2, detailed: 3 },
    style: {
      auto: 1,
      sketch_note: 2,
      professional: 3,
      bento_grid: 4,
      editorial: 5,
      instructional: 6,
      bricks: 7,
      clay: 8,
      anime: 9,
      kawaii: 10,
      scientific: 11,
    },
  },
  slide_deck: {
    format: { detailed: 1, presenter: 2 },
    length: { short: 1, default: 3 },
  },
};

export interface StudioRpcResult extends GenerateStudioResult {
  artifactId: string;
  sourceCount: number;
}

/**
 * Start the generation over RPC, or return null when the request needs the
 * dialog (see the module comment). Throws RpcError on protocol problems.
 */
export async function generateStudioRpc(
  page: Page,
  notebookId: string,
  req: GenerateStudioOptions
): Promise<StudioRpcResult | null> {
  const type = req.type as keyof typeof TYPE_CODES;
  if (req.generateLater || !(type in TYPE_CODES)) return null;
  const o = req.options ?? {};
  let lang: string | null;
  if (o.language) {
    lang = resolveLanguage(o.language)?.code ?? null;
    if (!lang) return null; // unknown name: the dialog reports what it offers
  } else {
    lang = await getOutputLanguageRpc(page);
    if (!lang) return null;
  }

  const codes = CODES[type];
  const pick = (field: string, value: string | undefined, fallback: number): number | null => {
    if (value === undefined) return fallback;
    return codes[field]?.[value] ?? null;
  };
  // Options this payload has no slot for → dialog.
  const unsupported = Object.entries(o).some(
    ([k, v]) => v !== undefined && !["language", "sources", ...Object.keys(codes)].includes(k)
  );
  if (unsupported) return null;

  const path = `/notebook/${notebookId}`;
  const details = await callRpc<unknown[]>(
    page,
    RPC_NOTEBOOK,
    [notebookId, null, [2], null, 0],
    path
  );
  const rawSources = (details?.[0] as unknown[] | undefined)?.[1];
  if (!Array.isArray(rawSources)) throw new RpcError("unexpected notebook response", RPC_NOTEBOOK);
  const items = rawSources
    .filter((s): s is unknown[] => Array.isArray(s) && Array.isArray(s[0]))
    .map((s) => ({ id: String((s[0] as unknown[])[0]), title: String(s[1] ?? "") }));
  if (items.length === 0) throw new Error("This notebook has no sources.");
  const ids = o.sources?.length
    ? [...(await resolveSourceIds(items, o.sources))]
    : items.map((i) => i.id);
  const nested = ids.map((id) => [[id]]);
  const simple = ids.map((id) => [id]);
  const prompt = req.prompt?.trim() || null;

  let content: unknown[];
  switch (type) {
    case "audio": {
      const format = pick("format", o.format, 1);
      const length = pick("length", o.length, 2);
      if (format === null || length === null) return null;
      content = [
        null,
        null,
        1,
        nested,
        null,
        null,
        [null, [prompt ?? "", length, null, simple, lang, null, format]],
      ];
      break;
    }
    case "video": {
      const format = pick("format", o.format, 1);
      if (format === null) return null;
      const inner: unknown[] = [simple, format === 4 ? null : lang, prompt ?? "", null, format];
      if (format === 4) inner.push(null, null, 1);
      else if (format !== 3) inner.push(1); // auto visual style
      content = [null, null, 3, nested, null, null, null, null, [null, null, inner]];
      break;
    }
    case "infographic": {
      const orientation = pick("orientation", o.orientation, 1);
      const detail = pick("detail", o.detail, 2);
      const style = pick("style", o.style, 1);
      if (orientation === null || detail === null || style === null) return null;
      content = [
        null,
        null,
        7,
        nested,
        ...Array(10).fill(null),
        [[prompt, lang, null, orientation, detail, style]],
      ];
      break;
    }
    case "slide_deck": {
      const format = pick("format", o.format, 1);
      const length = pick("length", o.length, 3);
      if (format === null || length === null) return null;
      content = [null, null, 8, nested, ...Array(12).fill(null), [[prompt, lang, format, length]]];
      break;
    }
  }

  const res = await callRpc<unknown[]>(page, RPC_CREATE, [[2], notebookId, content], path);
  const created = res?.[0] as unknown[] | undefined;
  const artifactId = created?.[0];
  if (typeof artifactId !== "string")
    throw new RpcError("generation returned no artifact id", RPC_CREATE);
  if (created?.[2] !== TYPE_CODES[type]) {
    // Something was created, so this must not fall back and create it again.
    throw new Error(
      `NotebookLM created a different output type (${String(created?.[2])}) than requested (${type}); ` +
        `check list_studio_artifacts (id ${artifactId}).`
    );
  }
  return {
    status: "started",
    message: `${type} generation started — poll list_studio_artifacts (id ${artifactId}).`,
    usagePercent: null,
    ...(o.sources?.length && {
      sources: items.filter((i) => ids.includes(i.id)).map((i) => i.title),
    }),
    artifactId,
    sourceCount: items.length,
  };
}
