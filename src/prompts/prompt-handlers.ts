/**
 * MCP `prompts` capability + the two template tools.
 *
 * prompts/list   → every template in the registry (paginated)
 * prompts/get    → one rendered user message (goal, tool contract, template)
 * tools          → `list_prompt_templates` / `get_prompt_template`, so clients
 *                  that do not surface MCP prompts can still use the templates
 */

import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { NotebookLibrary } from "../library/notebook-library.js";
import {
  PROMPT_TARGETS,
  PromptRegistry,
  type PromptTemplate,
  type RenderArgs,
} from "./registry.js";
import { log } from "../utils/logger.js";

const PAGE_SIZE = 100;

export class PromptHandlers {
  readonly registry = new PromptRegistry();

  constructor(private library: NotebookLibrary) {}

  registerHandlers(server: Server): void {
    server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      const all = this.registry.list();
      const start = Number(request.params?.cursor ?? 0) || 0;
      const page = all.slice(start, start + PAGE_SIZE);
      log.info(`🧩 [MCP] prompts/list (${start}–${start + page.length} of ${all.length})`);
      return {
        prompts: page.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          arguments: t.arguments,
        })),
        ...(start + PAGE_SIZE < all.length ? { nextCursor: String(start + PAGE_SIZE) } : {}),
      };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      const t = this.registry.resolve(name);
      if (!t)
        throw new Error(`Unknown prompt: ${name}. Use prompts/list or list_prompt_templates.`);
      const missing = t.arguments
        .filter((a) => a.required && !args[a.name]?.trim())
        .map((a) => a.name);
      if (missing.length) throw new Error(`Prompt "${name}" requires: ${missing.join(", ")}`);
      log.info(`🧩 [MCP] prompts/get ${name}`);
      return {
        description: t.description,
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: this.registry.render(t, args) },
          },
        ],
      };
    });
  }

  /** Completion values for prompt arguments (wired into the shared completion handler). */
  complete(promptName: string, argName: string, value: string): string[] {
    const t = this.registry.resolve(promptName);
    const q = value.toLowerCase();
    let values: string[] = [];
    if (argName === "lang") values = t?.langs ?? [];
    else if (argName === "lens") values = this.registry.lensNames();
    else if (argName === "notebook") values = this.library.listNotebooks().map((n) => n.id);
    return values.filter((v) => v.toLowerCase().includes(q)).slice(0, 50);
  }

  // ------------------------------------------------------------------ tools

  listTemplates(args: {
    query?: string;
    target?: string;
    pack?: string;
    lang?: string;
    limit?: number;
    offset?: number;
  }) {
    const hits = this.registry.search(args);
    const offset = Math.max(0, args.offset ?? 0);
    const limit = Math.min(Math.max(1, args.limit ?? 20), 100);
    return {
      total: hits.length,
      offset,
      templates: hits.slice(offset, offset + limit).map(summary),
    };
  }

  getTemplate(args: RenderArgs & { name: string }) {
    const t = this.registry.resolve(args.name);
    if (!t) throw new Error(`Unknown template: ${args.name}. Use list_prompt_templates to search.`);
    if (t.slot && !args.topic?.trim()) throw new Error(`Template "${t.name}" requires \`topic\`.`);
    const { text, lang } = this.registry.text(t, args);
    return {
      ...summary(t),
      lang,
      text,
      instructions: this.registry.render(t, args),
      source: t.sourceUrl,
      license: t.license,
    };
  }
}

function summary(t: PromptTemplate) {
  return {
    name: t.name,
    title: t.title,
    target: t.target,
    pack: t.pack,
    langs: t.langs,
    ...(t.level ? { level: t.level } : {}),
    ...(t.category ? { category: t.category } : {}),
    ...(t.attribution ? { attribution: t.attribution } : {}),
    description: t.description,
  };
}

export const promptTemplateTools: Tool[] = [
  {
    name: "list_prompt_templates",
    description:
      "Search the curated NotebookLM prompt templates bundled with this server (and any the user " +
      "added under NOTEBOOKLM_PROMPT_DIRS). Each template targets one action: `ask` (a chat " +
      "question), `configure_chat` (a notebook system instruction) or a Studio output type " +
      "(audio, video, slide_deck, mind_map, report, flashcards, quiz, infographic, data_table). " +
      "Filters combine; `query` matches all words against name, title, description and category. " +
      "Returns summaries only — fetch the text with `get_prompt_template`. Packs: `browser-plugin` " +
      "(EN + HU), `learner-pack` (topic + audience lens), plus user packs. Local and read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Keywords, e.g. "debate podcast" or "executive deck".',
        },
        target: {
          type: "string",
          enum: PROMPT_TARGETS,
          description: "Only templates for this action.",
        },
        pack: {
          type: "string",
          description: "Only this pack (e.g. browser-plugin, learner-pack).",
        },
        lang: {
          type: "string",
          description: "Only templates available in this language (en, hu …).",
        },
        limit: { type: "number", description: "Page size, 1–100. Default 20." },
        offset: { type: "number", description: "Results to skip, for paging. Default 0." },
      },
    },
    annotations: {
      title: "Search prompt templates",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_prompt_template",
    description:
      "Return one prompt template: its raw `text` (in `lang` if available) and `instructions` — " +
      "the same rendered message an MCP client gets from prompts/get, stating which tool to call " +
      "with the text. Learner-pack templates are composed from `topic` (required) and an audience " +
      "`lens`; `context` fills [BRACKETED] placeholders; `notebook` (library id or URL) is woven " +
      "into the instructions. Does not run anything in NotebookLM — call the named tool afterwards. " +
      "Also accepts the name of a duplicate that was folded into this template.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name from `list_prompt_templates`." },
        lang: { type: "string", description: "Preferred language (en, hu …). Default en." },
        topic: {
          type: "string",
          description: "Learner-pack templates: the topic (required there).",
        },
        lens: {
          type: "string",
          description:
            "Learner-pack templates: eli5, newbie, clinical, operator, finance, deep_dive.",
        },
        context: {
          type: "string",
          description: "Details for the template's [BRACKETED] placeholders.",
        },
        notebook: { type: "string", description: "Library notebook id or notebook URL." },
      },
      required: ["name"],
    },
    annotations: {
      title: "Get prompt template",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
