/**
 * MCP tool definitions for the 2026-09 "Gemini Notebook" features:
 * the full Studio (all nine output types), the usage/limits dialog and the
 * chat configuration. Additive — the audio tools in `sources.ts` are kept.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { sharedNotebookTargeting } from "./sources.js";

const showBrowser = {
  show_browser: {
    type: "boolean",
    description: "Show the browser window for debugging. Default: false.",
  },
};

export const generateStudioArtifactTool: Tool = {
  name: "generate_studio_artifact",
  description:
    "Create any Studio output for a notebook: `video`, `slide_deck`, `mind_map`, " +
    "`report`, `flashcards`, `quiz`, `infographic`, `data_table` (and `audio`, " +
    "though `generate_audio` offers audio-specific options).\n\n" +
    "Opens the type's customise dialog, fills the optional `prompt` and clicks " +
    '"Generate now" — or "Generate later" with `generate_later: true`, which ' +
    "queues the job outside the current limit window (ready within hours).\n\n" +
    "Returns immediately; poll `list_studio_artifacts` until the new item is " +
    "`ready` (clients that support MCP tasks can run it as a task instead, which " +
    "completes when the item is ready). Each generation consumes AI usage — check " +
    "`get_usage` first when running several.\n\n" +
    "Set `ask_options: true` when the user wants to pick the settings themselves: " +
    "they get a form with this type's options, pre-filled with your arguments.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [
          "video",
          "slide_deck",
          "mind_map",
          "report",
          "flashcards",
          "quiz",
          "infographic",
          "data_table",
          "audio",
        ],
        description: "Studio output type.",
      },
      prompt: {
        type: "string",
        description:
          'Optional focus / description, e.g. "A deck for beginners in a playful style". ' +
          "Ignored for types whose dialog has no free-text field (e.g. report templates).",
      },
      generate_later: {
        type: "boolean",
        description:
          'Use "Generate later" (queued, does not use the current limit window). Default false.',
      },
      format: {
        type: "string",
        description:
          "Per type — audio: deep_dive | brief | critique | debate; video: cinematic | " +
          "short | explainer; slide_deck: detailed | presenter; report: interactive | document.",
      },
      length: {
        type: "string",
        enum: ["short", "default", "long"],
        description: "audio, slide_deck. `long` only where offered.",
      },
      count: {
        type: "string",
        enum: ["fewer", "standard", "more"],
        description: "flashcards, quiz: number of cards / questions.",
      },
      difficulty: {
        type: "string",
        enum: ["easy", "medium", "hard"],
        description: "flashcards, quiz.",
      },
      include_images: {
        type: "boolean",
        description: "flashcards: include images (default true).",
      },
      orientation: {
        type: "string",
        enum: ["landscape", "portrait", "square"],
        description: "infographic.",
      },
      detail: {
        type: "string",
        enum: ["concise", "standard", "detailed"],
        description: "infographic level of detail (`detailed` is beta).",
      },
      style: {
        type: "string",
        enum: [
          "auto",
          "sketch_note",
          "professional",
          "bento_grid",
          "editorial",
          "instructional",
          "bricks",
          "clay",
          "anime",
          "kawaii",
          "scientific",
        ],
        description: "infographic visual style.",
      },
      language: {
        type: "string",
        description:
          'Output language by the name NotebookLM lists, e.g. "English", "magyar", "Deutsch" ' +
          "(all types except video). Defaults to the notebook's output language.",
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description:
          "Restrict the output to these sources — each entry is a source title (exact or a " +
          "unique substring) or source id. Omit to use all sources. Very useful in " +
          "multi-source notebooks. Not available for `report`.",
      },
      template: {
        type: "string",
        enum: ["learning_overview", "create_your_own", "briefing_doc", "study_guide", "blog_post"],
        description:
          "report only. `learning_overview` = interactive report; the others are document " +
          "reports. A `prompt` is appended to the template's built-in instructions; " +
          "`create_your_own` uses the prompt alone (required). Default: learning_overview, or " +
          "create_your_own when `format: document` and a prompt is given.",
      },
      ask_options: {
        type: "boolean",
        description:
          "Show the user a form to choose the options (needs client elicitation support; " +
          "otherwise the given arguments are used). Default false.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
    required: ["type"],
  },
  annotations: {
    title: "Generate Studio output",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const listStudioArtifactsTool: Tool = {
  name: "list_studio_artifacts",
  description:
    "List the Studio library of a notebook: every generated output with its " +
    "`type` (audio, video, slide_deck, mind_map, report, flashcards, quiz, " +
    "infographic, data_table or unknown), `title`, `details` (sources, age, " +
    "duration) and `status` (`ready` | `generating`). Read-only — use it to poll " +
    "after `generate_studio_artifact` / `generate_audio`.",
  inputSchema: {
    type: "object",
    properties: { ...showBrowser, ...sharedNotebookTargeting },
  },
  annotations: {
    title: "List Studio outputs",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const getUsageTool: Tool = {
  name: "get_usage",
  description:
    'Read the "AI Usage & Limits" dialog (Settings → Usage). Gemini Notebook ' +
    "meters AI usage instead of a fixed daily query count: a short rolling window " +
    "(resets every few hours) and a weekly limit. Returns both percentages and " +
    "their reset times as shown in the UI. Read-only.",
  inputSchema: {
    type: "object",
    properties: { ...showBrowser, ...sharedNotebookTargeting },
  },
  annotations: {
    title: "Get AI usage & limits",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const configureChatTool: Tool = {
  name: "configure_chat",
  description:
    "Read or set the notebook's **system instruction** — NotebookLM's " +
    '"Configure Chat" (notebook menu → Configure Chat). `custom_prompt` works ' +
    "like a main/system prompt for the notebook's model: it defines role, " +
    "style, tone, language and rules for every answer.\n\n" +
    "**Persistent and notebook-wide:** it is stored on the notebook and shapes " +
    "*every* later `ask_question` on it (and the web UI chat) until changed. " +
    "Call without `goal` / `custom_prompt` / `response_length` to read the " +
    'current instruction first; restore it (or set `goal: "default"`) when a ' +
    "temporary instruction is no longer wanted. If answers look oddly styled, " +
    "read this setting before blaming the sources.\n\n" +
    "`goal`: `default` (general research), `learning_guide` (tutor style) or " +
    "`custom` (the instruction in `custom_prompt`, max 10 000 chars). " +
    "`response_length`: `default`, `longer`, `shorter`.",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        enum: ["default", "learning_guide", "custom"],
        description: "Conversational goal. Omit to keep the current one.",
      },
      custom_prompt: {
        type: "string",
        description:
          "System instruction for the notebook (role, style, tone, output rules), e.g. " +
          '"You are a senior code reviewer. Answer in Hungarian, max 5 bullet points." ' +
          'Implies goal "custom" when `goal` is omitted. Max 10 000 chars. ' +
          "Replaces the previous instruction.",
      },
      response_length: {
        type: "string",
        enum: ["default", "longer", "shorter"],
        description: "Answer length. Omit to keep the current one.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
  },
  annotations: {
    title: "Configure notebook chat",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const saveAnswerAsNoteTool: Tool = {
  name: "save_answer_as_note",
  description:
    'Pin a chat answer as a note in the notebook\'s Studio ("Save to note"). Targets the ' +
    "answer to `question` (exact question text, else substring; last matching turn) or, " +
    "when omitted, the latest answer. Returns the note title and a preview so you can " +
    "confirm the right answer was saved.\n\n" +
    "Combine with `convert_note_to_source` to turn a worked-out answer into a source " +
    "that later questions and Studio outputs can build on.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Question whose answer to save. Omit for the latest answer.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
  },
  annotations: {
    title: "Save answer as note",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const convertNoteToSourceTool: Tool = {
  name: "convert_note_to_source",
  description:
    'Turn a note into a notebook source ("Convert to source"), or every note at once ' +
    "with `all: true`. The note's text becomes a regular source: it is then used by " +
    "`ask_question` and can be picked in Studio `sources`. Returns source counts " +
    "before/after. List notes with `list_studio_artifacts` (type `note`).",
  inputSchema: {
    type: "object",
    properties: {
      note_title: {
        type: "string",
        description: "Note title (exact, or a unique substring). Required unless `all` is true.",
      },
      all: { type: "boolean", description: "Convert all notes. Default false." },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
  },
  annotations: {
    title: "Convert note to source",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const listSourcesTool: Tool = {
  name: "list_sources",
  description:
    "List the notebook's sources: `id` (stable UUID), `title`, `kind` (source-type glyph, " +
    "e.g. `description` = pasted text, `markdown` = converted note, `web`) and `selected` " +
    "(whether the chat currently uses it). Use the ids in `sources` arguments of " +
    "`ask_question`, `generate_studio_artifact` and `generate_audio` when titles are " +
    "duplicated or ambiguous. Read-only.",
  inputSchema: {
    type: "object",
    properties: { ...showBrowser, ...sharedNotebookTargeting },
  },
  annotations: {
    title: "List notebook sources",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const deleteSourceTool: Tool = {
  name: "delete_source",
  description:
    "**Permanently** remove a source from the notebook (sidebar → More → Remove " +
    "source). Cannot be undone. The server asks the user to approve the deletion " +
    "directly (MCP elicitation prompt naming the source); on clients without " +
    "elicitation support `confirm: true` is required instead, set only after the user " +
    "explicitly approved deleting this specific source. Identify the source " +
    "by id (preferred, see `list_sources`) or by exact / unique title. Success is only " +
    "reported after NotebookLM acknowledged the request and the source disappeared.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source id, exact title, or unique title substring." },
      confirm: {
        type: "boolean",
        description:
          "Only used when the MCP client cannot show an approval prompt (no elicitation " +
          "support): then it must be true, set only after explicit user approval.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
    required: ["source"],
  },
  annotations: {
    title: "Delete source (permanent)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const deleteStudioArtifactTool: Tool = {
  name: "delete_studio_artifact",
  description:
    "**Permanently** delete a Studio output (audio, video, report, quiz, …) or a note " +
    "(More → Delete). Cannot be undone. The server asks the user to approve it directly " +
    "(MCP elicitation prompt naming the entry); on clients without elicitation support " +
    "`confirm: true` is required instead, set only after the user explicitly approved " +
    "deleting this specific entry. Identify it by id (preferred), exact title (or a " +
    "unique substring); `kind` narrows to `note` or `studio_item` when titles overlap. " +
    "List entries with `list_studio_artifacts`.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Entry id from `list_studio_artifacts` (required to tell identical titles apart), " +
          "exact title, or unique title substring.",
      },
      kind: {
        type: "string",
        enum: ["note", "studio_item"],
        description: "Restrict the match to notes or to generated outputs.",
      },
      confirm: {
        type: "boolean",
        description:
          "Only used when the MCP client cannot show an approval prompt (no elicitation " +
          "support): then it must be true, set only after explicit user approval.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
    required: ["title"],
  },
  annotations: {
    title: "Delete Studio output or note (permanent)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const downloadStudioArtifactTool: Tool = {
  name: "download_studio_artifact",
  description:
    "Save a finished Studio output to disk. Works for every type, through " +
    "NotebookLM's own data API (no menu clicks):\n" +
    "  • audio → .m4a · video → .mp4 · infographic → .png\n" +
    "  • slide_deck → .pdf (default) or .pptx (`format`)\n" +
    "  • report → .md · data_table → .csv (.xlsx for spreadsheet exports)\n" +
    "  • quiz / flashcards → .md (default), .json or .html (`format`)\n" +
    "  • mind_map → .json (node tree)\n\n" +
    "Identify the item with `artifact_id` (the `id` from " +
    "`list_studio_artifacts`; a unique prefix is enough) or with `type` for " +
    "the newest finished item of that type. The file is named after the " +
    "item's title; an existing file is not overwritten (a ` (2)` suffix is " +
    "added). Returns `file_path`, `bytes` and the item.",
  inputSchema: {
    type: "object",
    properties: {
      destination_dir: {
        type: "string",
        description: "Absolute directory to save into (created if missing).",
      },
      artifact_id: {
        type: "string",
        description: "Studio item id from `list_studio_artifacts` (or a unique prefix).",
      },
      type: {
        type: "string",
        enum: [
          "audio",
          "video",
          "infographic",
          "slide_deck",
          "report",
          "data_table",
          "quiz",
          "flashcards",
          "mind_map",
        ],
        description: "Without `artifact_id`: download the newest finished item of this type.",
      },
      format: {
        type: "string",
        enum: ["pdf", "pptx", "markdown", "json", "html"],
        description:
          "slide_deck: pdf (default) | pptx. quiz / flashcards: markdown (default) | json | html.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
    required: ["destination_dir"],
  },
  annotations: {
    title: "Download Studio output",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const studioTools: Tool[] = [
  deleteSourceTool,
  deleteStudioArtifactTool,
  listSourcesTool,
  saveAnswerAsNoteTool,
  convertNoteToSourceTool,
  generateStudioArtifactTool,
  listStudioArtifactsTool,
  downloadStudioArtifactTool,
  getUsageTool,
  configureChatTool,
];
