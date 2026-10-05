/**
 * Icons for the server and its tools (MCP `icons`, spec 2025-11-25). Inline
 * SVG data URIs, so they work offline; one variant per client theme.
 */

import type { Icon } from "@modelcontextprotocol/sdk/types.js";

const PATHS = {
  notebook: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11",
  chat: "M4 5h16v11H9l-5 4z M8 9h8 M8 12h5",
  studio: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  sources: "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6",
  prompts: "M4 6h16 M4 12h10 M4 18h7",
  system: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3",
} as const;

type IconName = keyof typeof PATHS;

function icons(name: IconName): Icon[] {
  return (["light", "dark"] as const).map((theme) => {
    const stroke = theme === "light" ? "#1f1f1f" : "#e3e3e3";
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" ` +
      `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[name]}"/></svg>`;
    return {
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      mimeType: "image/svg+xml",
      sizes: ["any"],
      theme,
    };
  });
}

export const SERVER_ICONS = icons("notebook");

const TOOL_GROUPS: Record<IconName, string[]> = {
  notebook: [
    "add_notebook",
    "import_account_notebooks",
    "list_notebooks",
    "get_notebook",
    "select_notebook",
    "update_notebook",
    "remove_notebook",
    "search_notebooks",
    "get_library_stats",
  ],
  chat: ["ask_question", "configure_chat", "configure_output_language", "save_answer_as_note"],
  studio: [
    "generate_studio_artifact",
    "list_studio_artifacts",
    "delete_studio_artifact",
    "generate_audio",
    "get_audio_status",
    "download_audio",
    "download_studio_artifact",
  ],
  sources: ["add_source", "list_sources", "delete_source", "convert_note_to_source"],
  prompts: ["list_prompt_templates", "get_prompt_template"],
  system: [],
};

const TOOL_ICON: Record<string, IconName> = {};
for (const [icon, tools] of Object.entries(TOOL_GROUPS)) {
  for (const t of tools) TOOL_ICON[t] = icon as IconName;
}

/** Icons for a tool by its group; session, auth and health tools use the system icon. */
export function toolIcons(toolName: string): Icon[] {
  return icons(TOOL_ICON[toolName] ?? "system");
}
