/**
 * MCP tool definitions for the notebook's chat history: export the whole
 * conversation and delete it. The chat history is part of the context every
 * later answer is given, so reading it back and starting clean are both
 * context-engineering tools.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { sharedNotebookTargeting } from "./sources.js";

const showBrowser = {
  show_browser: {
    type: "boolean",
    description: "Show the browser window for debugging. Default: false.",
  },
};

export const getChatHistoryTool: Tool = {
  name: "get_chat_history",
  description:
    "Read the notebook's whole chat history: every question and answer, oldest first, " +
    "with timestamps and — for answers — the sources and passages behind the `[N]` " +
    "citation markers. The web app loads long chats lazily, page by page; this tool " +
    "pages through all of it over NotebookLM's data API, so the result is complete " +
    "however long the chat is (set `max_turns` to keep only the newest messages).\n\n" +
    "Use it to see what was asked before — the chat history is part of the context " +
    "every later answer is given — to review or archive a conversation, or to take a " +
    "copy before `delete_chat_history`.\n\n" +
    "Without `destination_dir` the content comes back in the result (`markdown`, or " +
    "`history` for format `json`) — for long chats prefer `destination_dir` or " +
    "`max_turns`. With it the file is saved (named after the notebook, never " +
    "overwriting) and the result carries `file_path` and `bytes`. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["markdown", "json"],
        description: "markdown (default, readable) or json (structured turns).",
      },
      destination_dir: {
        type: "string",
        description:
          "Absolute directory to save the export into (created if missing). Omit to get " +
          "the content back in the result.",
      },
      include_citations: {
        type: "boolean",
        description:
          "Attach the cited source passages to answers. Default true; false makes a " +
          "much smaller export.",
      },
      max_turns: {
        type: "integer",
        minimum: 1,
        description:
          "Keep only the newest N messages (a question and its answer are two). Default: all.",
      },
      ...showBrowser,
      ...sharedNotebookTargeting,
    },
  },
  annotations: {
    title: "Get chat history",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const deleteChatHistoryTool: Tool = {
  name: "delete_chat_history",
  description:
    "**Permanently** delete the notebook's whole chat history (Notebook menu → Delete " +
    "chat history). Cannot be undone; sources, notes and Studio outputs stay. Use it " +
    "to start a new line of work without the earlier questions steering the answers — " +
    "the chat history is context every later answer is given. The server asks the user " +
    "to approve it directly (MCP elicitation prompt naming the notebook); on clients " +
    "without elicitation support `confirm: true` is required instead, set only after " +
    "the user explicitly approved deleting this chat history.\n\n" +
    "Pass `backup_dir` to save the conversation as Markdown first (after the approval, " +
    "right before deleting) — or call `get_chat_history` beforehand. Afterwards " +
    "NotebookLM is checked to confirm the conversation is empty.",
  inputSchema: {
    type: "object",
    properties: {
      backup_dir: {
        type: "string",
        description:
          "Absolute directory to save a Markdown copy of the chat into before deleting " +
          "(created if missing).",
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
  },
  annotations: {
    title: "Delete chat history (permanent)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const chatHistoryTools: Tool[] = [getChatHistoryTool, deleteChatHistoryTool];
