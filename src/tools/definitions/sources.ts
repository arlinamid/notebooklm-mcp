/**
 * MCP tool definitions for source ingestion + Audio Overview (issues #25, #11).
 *
 * The cross-tool async-audio chain (generate → poll → download) is documented
 * in the server-level `instructions` string (see src/index.ts) so individual
 * descriptions stay focused on one operation each.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const sharedNotebookTargeting = {
  session_id: {
    type: "string",
    description:
      "Reuse an existing browser session by id. Recommended when you have " +
      "already called `ask_question` against the same notebook — saves the " +
      "10–15 s page-load time. Obtain from `list_sessions` or any prior " +
      "`ask_question` response (`result.session_id`).",
  },
  notebook_id: {
    type: "string",
    description:
      "Library notebook id (from `list_notebooks` / `search_notebooks`). " +
      "Defaults to the active notebook (see `select_notebook`) when omitted.",
  },
  notebook_url: {
    type: "string",
    description:
      "Direct NotebookLM URL — overrides `notebook_id`. Use for ad-hoc " +
      "notebooks not yet in your library. Format: " +
      "`https://notebook.google.com/notebook/<uuid>`.",
  },
};

export const addSourceTool: Tool = {
  name: "add_source",
  description:
    "Ingest sources into a NotebookLM notebook:\n" +
    "  • `url` — NotebookLM crawls and indexes a website\n" +
    "  • `youtube` — a public YouTube video (its transcript is imported)\n" +
    "  • `text` — paste raw text (treated as a copied document)\n" +
    "  • `file` — upload local files (`file_paths`: pdf, txt, md, docx, audio, " +
    "images …); one source per file\n\n" +
    "For `url` / `youtube`, several URLs can be passed in `content` separated " +
    "by spaces or new lines. Google Drive import is not implemented.\n\n" +
    "Returns `sourceCountBefore`/`sourceCountAfter` so the caller can verify " +
    "the new source landed. NotebookLM finishes indexing within 5–30 seconds; " +
    "subsequent `ask_question` calls then have the new source in context. " +
    "Free notebooks cap at 50 sources.\n\n" +
    "Known quirk: pasted-text uploads occasionally redirect to a freshly " +
    'created "Untitled notebook" on Google\'s side. The tool detects this ' +
    "and returns a clear error so you can re-try against the correct URL.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["url", "youtube", "text", "file"],
        description:
          "`url` crawls a website, `youtube` imports a video transcript, `text` " +
          "ingests `content` verbatim, `file` uploads `file_paths`.",
      },
      content: {
        type: "string",
        description:
          "When `type=url`/`youtube`: fully-qualified URL(s) (https://…), several " +
          "separated by spaces or new lines. When `type=text`: the raw text body " +
          "(up to NotebookLM's per-source word limit). Not used for `file`.",
      },
      file_paths: {
        type: "array",
        items: { type: "string" },
        description: "`type=file` only: absolute paths of local files to upload.",
      },
      title: {
        type: "string",
        description:
          "Display title shown in the source list. Optional — NotebookLM " +
          "picks a sensible default (page title for URLs, first line for text). " +
          "For text sources, supplying a title is recommended for later " +
          "identification.",
      },
      show_browser: {
        type: "boolean",
        description: "Show the browser window for debugging. Default: false.",
      },
      ...sharedNotebookTargeting,
    },
    required: ["type"],
  },
  annotations: {
    title: "Add source to notebook",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const generateAudioTool: Tool = {
  name: "generate_audio",
  description:
    "Trigger podcast-style Audio Overview generation for a notebook.\n\n" +
    "**Async by default** — returns immediately with one of:\n" +
    '  • `status: "started"` — generation just kicked off\n' +
    '  • `status: "in_progress"` — a generation was already running; ' +
    "this call attached to it\n" +
    '  • `status: "ready"` (with `alreadyExisted: true`) — an Audio ' +
    "Overview already existed; nothing was triggered\n\n" +
    "Generation typically takes 2–10 minutes. **Workflow:**\n" +
    "  1. `generate_audio` → returns immediately\n" +
    "  2. Poll `get_audio_status` every ~30 s\n" +
    "  3. When status is `ready`, call `download_audio`\n\n" +
    "Pass `wait_for_completion: true` for legacy synchronous behaviour " +
    "(blocks for up to `timeout_ms`). Other Studio outputs (video, slides, " +
    "mind map, report, flashcards, quiz, infographic, data table) are " +
    "available via `generate_studio_artifact`.",
  inputSchema: {
    type: "object",
    properties: {
      custom_prompt: {
        type: "string",
        description:
          'Optional focus prompt for the Audio Overview, e.g. "Focus on the ' +
          'API authentication flow and skip pricing". Passed into the ' +
          'NotebookLM "Customize" sub-dialog before generation starts.',
      },
      format: {
        type: "string",
        enum: ["deep_dive", "brief", "critique", "debate"],
        description:
          "Optional episode format (2026-09 Studio dialog). `deep_dive` = two-host " +
          "conversation (NotebookLM default), `brief` = bite-sized overview, " +
          "`critique` = expert review of the sources, `debate` = two hosts debating.",
      },
      length: {
        type: "string",
        enum: ["short", "default", "long"],
        description:
          "Optional episode length. `long` is only offered on some accounts; " +
          "when unavailable the NotebookLM default is kept.",
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description:
          "Restrict the episode to these sources (title, unique title substring, or " +
          "source id). Omit to use all sources.",
      },
      generate_later: {
        type: "boolean",
        description:
          'Use NotebookLM\'s "Generate later" queue instead of "Generate now": ' +
          "does not count against the current limit window, ready within hours. " +
          "Default false.",
      },
      wait_for_completion: {
        type: "boolean",
        description:
          "If true, block until the audio tile is ready (up to `timeout_ms`). " +
          "Default false — return immediately and let the caller poll " +
          "`get_audio_status`.",
      },
      timeout_ms: {
        type: "number",
        description:
          "Only relevant when `wait_for_completion=true`. Maximum wait for " +
          "the audio tile to appear. Default 600 000 (10 min).",
      },
      show_browser: {
        type: "boolean",
        description: "Show the browser window for debugging. Default: false.",
      },
      ...sharedNotebookTargeting,
    },
  },
  annotations: {
    title: "Generate Audio Overview",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true, // Idempotent: existing audio is detected and returned as ready
    openWorldHint: true,
  },
};

export const getAudioStatusTool: Tool = {
  name: "get_audio_status",
  description:
    "Non-blocking probe for the current Audio Overview state of a notebook.\n\n" +
    "Returned `status` values:\n" +
    "  • `ready` — Audio Overview is generated and ready to download\n" +
    "  • `in_progress` — generation is currently running\n" +
    "  • `not_started` — no Audio Overview exists yet for this notebook\n\n" +
    "Safe to poll every ~30 s while waiting for `generate_audio` to finish. " +
    "When status flips to `ready`, call `download_audio` with a destination " +
    "directory.",
  inputSchema: {
    type: "object",
    properties: {
      show_browser: {
        type: "boolean",
        description: "Show the browser window for debugging. Default: false.",
      },
      ...sharedNotebookTargeting,
    },
  },
  annotations: {
    title: "Get Audio Overview status",
    readOnlyHint: true,
    openWorldHint: true,
  },
};

export const downloadAudioTool: Tool = {
  name: "download_audio",
  description:
    "Save the completed Audio Overview to disk as a `.m4a` file. **Pre-" +
    'condition:** `get_audio_status` must report `status: "ready"`. ' +
    "Calling this before generation completes returns an error message " +
    "explaining what to do.\n\n" +
    "The file lands in `destination_dir` with NotebookLM's suggested " +
    "filename (sanitised — usually the audio's title with underscores). " +
    "The full saved path is returned in `result.filePath`.",
  inputSchema: {
    type: "object",
    properties: {
      destination_dir: {
        type: "string",
        description:
          "Absolute directory path where the file is saved (created if " +
          "missing). Example: `/Users/jane/Downloads/notebooklm` or " +
          "`/tmp/audio`. Relative paths are NOT recommended — the server " +
          "may run from a different working directory than the caller.",
      },
      show_browser: {
        type: "boolean",
        description: "Show the browser window for debugging. Default: false.",
      },
      ...sharedNotebookTargeting,
    },
    required: ["destination_dir"],
  },
  annotations: {
    title: "Download Audio Overview",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const sourceTools: Tool[] = [
  addSourceTool,
  generateAudioTool,
  getAudioStatusTool,
  downloadAudioTool,
];
