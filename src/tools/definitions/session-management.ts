import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Session management tools. The MCP server uses session IDs to keep
 * Gemini-side conversational context across follow-up `ask_question`
 * calls. These tools surface, reset, and close those sessions.
 *
 * Where do session IDs come from? — Every successful `ask_question` call
 * returns a `session_id` in its result. `list_sessions` enumerates the
 * currently live ones.
 */
export const sessionManagementTools: Tool[] = [
  {
    name: "list_sessions",
    description:
      "List all active browser sessions for this server. Each entry includes " +
      "`id`, `created_at`, `last_activity`, `age_seconds`, `inactive_seconds`, " +
      "`message_count`, `notebook_url`, `current_operation` (the tool call " +
      "driving the session's tab, or null) and `queued_operations` (calls " +
      "waiting for it — calls on one session run one at a time). Useful " +
      "before `reset_session` / `close_session` or to recover a `session_id` " +
      "you can pass back into `ask_question` to continue an existing " +
      "conversation. Idle sessions older than `session_timeout` (see " +
      "`get_health`) are auto-closed; busy ones are kept.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      title: "List sessions",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "close_session",
    description:
      "Permanently close a session and discard its browser tab. Use the " +
      "`id` returned by `list_sessions` (or the `session_id` from a prior " +
      "`ask_question` response). Closed sessions cannot be resumed — start " +
      "a new one with `ask_question` (no `session_id`) or pick another " +
      "from `list_sessions`. Ask the user before closing if the session " +
      "might still be needed.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Session id to close. Obtain from `list_sessions` or from any " +
            "prior `ask_question` response (`result.session_id`).",
        },
      },
      required: ["session_id"],
    },
    annotations: {
      title: "Close session",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "reset_session",
    description:
      "Reload a session's tab and reset its message counter, keeping the same " +
      "session id. This does NOT delete the notebook's stored conversation: " +
      "answers asked over NotebookLM's data API (the default) keep continuing " +
      "that conversation, earlier questions included. To start a new line of " +
      "work without them, save a copy with `get_chat_history` if needed and " +
      "call `delete_chat_history` (the user approves it).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Session id to reset. Obtain from `list_sessions` or from a " +
            "prior `ask_question` response (`result.session_id`).",
        },
      },
      required: ["session_id"],
    },
    annotations: {
      title: "Reset session",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
