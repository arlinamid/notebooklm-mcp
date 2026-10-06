import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Library tools — manage the local catalogue of NotebookLM notebooks the
 * user has registered with this server. The cross-tool ID flow (where
 * `id` comes from, where it's used) lives in the server-level
 * `instructions` string.
 */
export const notebookManagementTools: Tool[] = [
  {
    name: "add_notebook",
    description:
      "Register a NotebookLM notebook in the local library so it can be " +
      "queried with `ask_question`, ingested into with `add_source`, etc.\n\n" +
      "For a brand-new notebook use `create_notebook`; for the account's own " +
      "notebooks `import_account_notebooks` (no link needed).\n\n" +
      "## Required URL\n" +
      "The user must supply a NotebookLM share-link. To produce one:\n" +
      "  1. Open https://notebook.google.com\n" +
      '  2. Open the notebook → click "Share" (top right)\n' +
      '  3. Set "Anyone with the link" → "Copy link"\n\n' +
      "## Permission workflow\n" +
      "Do NOT call this tool unprompted. The expected dialogue is:\n" +
      "  1. Ask for the URL\n" +
      "  2. Ask what knowledge it contains (1–2 sentences) → `description`\n" +
      "  3. Ask which topics it covers (3–5) → `topics`\n" +
      "     (Or omit both: the server proposes them from the source titles — " +
      "written by your model via sampling when the client supports it — and " +
      "returns them as `generated_metadata`; show them to the user, and fix " +
      "them with `update_notebook` if needed.)\n" +
      "  4. Ask when it should be consulted → `use_cases`\n" +
      "  5. Propose a `name` and the metadata back to the user\n" +
      "  6. Only after explicit confirmation, call `add_notebook`.\n\n" +
      "Free-tier limits: 100 notebooks · 50 sources each; AI usage is metered " +
      "(see `get_usage`). Google AI Pro/Ultra raises these.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "NotebookLM share URL. Format: " +
            "`https://notebook.google.com/notebook/<uuid>` (with optional " +
            "`?authuser=N` suffix).",
        },
        name: {
          type: "string",
          description: "Display name (e.g. 'n8n Documentation').",
        },
        description: {
          type: "string",
          description:
            "1–2 sentence summary of what the notebook contains. Omit to have it proposed.",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description:
            "3–5 topics covered. Used by `search_notebooks`. Omit to have them proposed.",
        },
        content_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Content classification, e.g. ['documentation', 'examples', 'best practices'].",
        },
        use_cases: {
          type: "array",
          items: { type: "string" },
          description:
            "When the LLM should consult this notebook, e.g. ['Implementing n8n workflows'].",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional free-form tags for organisation.",
        },
      },
      required: ["url", "name"],
    },
    annotations: {
      title: "Add notebook to library",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "import_account_notebooks",
    description:
      "Read the notebooks of the signed-in Google account from the NotebookLM " +
      "homepage and add the ones not yet in the local library. Unlike " +
      "`add_notebook` no share-link is needed — the notebooks are opened as the " +
      "signed-in user.\n\n" +
      "## Workflow\n" +
      "  1. Call with `dry_run: true` to list what the account has (`status: " +
      '"would_import"` / `"already_in_library"`), and show the user the list.\n' +
      "  2. Import all of them, or only the ones the user picks via " +
      "`notebook_ids` (the `uuid` values) or a title `query`.\n" +
      "  3. Imported entries get a placeholder description and no topics; offer " +
      "to fill them in with `update_notebook`.\n\n" +
      "Skips notebooks already in the library (matched by the UUID in the URL). " +
      "Featured / Discover notebooks are never imported. Only adds library " +
      "entries — nothing changes on Google's side.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["mine", "shared", "all"],
          description:
            '"mine" (default) = notebooks the account owns; "shared" = shared with ' +
            'the account; "all" = both.',
        },
        query: {
          type: "string",
          description: "Only notebooks whose title contains this text (case-insensitive).",
        },
        notebook_ids: {
          type: "array",
          items: { type: "string" },
          description: "Only these notebooks: `uuid` values from a dry run, or notebook URLs.",
        },
        dry_run: {
          type: "boolean",
          description: "List what would be imported without changing the library. Default false.",
        },
      },
    },
    annotations: {
      title: "Import notebooks from the Google account",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "create_notebook",
    description:
      "Create a new, empty notebook in the signed-in Google account and add it " +
      "to the local library — no share-link or web UI needed. By default it also " +
      "becomes the active notebook, so `add_source` / `ask_question` target it.\n\n" +
      "Call only when the user asks for a new notebook. Next steps: `add_source` " +
      "(vetted sources), then `update_notebook` to fill in description/topics " +
      "once the content is known.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notebook title as shown in NotebookLM." },
        description: {
          type: "string",
          description: "Optional 1–2 sentence library description.",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Optional topics for `search_notebooks`.",
        },
        use_cases: {
          type: "array",
          items: { type: "string" },
          description: "Optional: when the notebook should be consulted.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: 'Optional library tags (default ["created", "own"]).',
        },
        select: {
          type: "boolean",
          description: "Make it the active notebook. Default true.",
        },
      },
      required: ["title"],
    },
    annotations: {
      title: "Create notebook in the Google account",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "rename_notebook",
    description:
      "Rename a notebook in NotebookLM itself (the title in the web app) and " +
      "update its library name to match. To change only the local library " +
      "name, use `update_notebook` instead.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Library notebook id (from `list_notebooks`)." },
        title: { type: "string", description: "New notebook title." },
      },
      required: ["id", "title"],
    },
    annotations: {
      title: "Rename notebook in the Google account",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "delete_notebook",
    description:
      "**Permanently delete** a notebook from the Google account — with all its " +
      "sources, notes and Studio outputs — and remove it from the local library. " +
      "Cannot be undone. (`remove_notebook` only forgets the library entry.)\n\n" +
      "The user is asked to approve it directly when the MCP client supports " +
      "elicitation; otherwise `confirm: true` is required. Name the notebook and " +
      "get an explicit yes from the user before calling.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Library notebook id (from `list_notebooks`)." },
        confirm: {
          type: "boolean",
          description:
            "Set true only after the user explicitly confirmed (used when the client " +
            "cannot show an approval prompt).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Delete notebook from the Google account",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "pin_notebook",
    description:
      'Pin a notebook to the top of the NotebookLM homepage ("Pin to top"), or unpin it ' +
      "with `pinned: false`.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Library notebook id (from `list_notebooks`)." },
        pinned: { type: "boolean", description: "true = pin (default), false = unpin." },
      },
      required: ["id"],
    },
    annotations: {
      title: "Pin notebook on the homepage",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "list_collections",
    description:
      "List the account's collections — the homepage's named groups of notebooks — with " +
      "each notebook's title, NotebookLM `uuid` and library id (null when not in the " +
      "library; `import_account_notebooks` brings it in).",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      title: "List collections",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "manage_collection",
    description:
      "Create, change or delete a collection (homepage → Collections / a notebook's " +
      '"Add to collection").\n' +
      "  • `create`: `name`, optional `add_notebooks`.\n" +
      "  • `update`: `collection` plus any of `name` (rename), `add_notebooks`, " +
      "`remove_notebooks`.\n" +
      "  • `delete`: `collection`. The notebooks in it are kept. Asks the user to approve " +
      "(elicitation), otherwise needs `confirm: true`.\n" +
      "Notebooks are given as library ids, notebook URLs or NotebookLM UUIDs; a collection " +
      "by id or exact name (see `list_collections`).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update", "delete"] },
        collection: {
          type: "string",
          description: "update/delete: collection id or exact name.",
        },
        name: { type: "string", description: "create: the name; update: the new name." },
        add_notebooks: {
          type: "array",
          items: { type: "string" },
          description: "Notebooks to put in the collection.",
        },
        remove_notebooks: {
          type: "array",
          items: { type: "string" },
          description: "update: notebooks to take out of the collection.",
        },
        confirm: {
          type: "boolean",
          description:
            "delete only, when the client cannot show an approval prompt: true after the " +
            "user explicitly confirmed.",
        },
      },
      required: ["action"],
    },
    annotations: {
      title: "Create, change or delete a collection",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "share_notebook",
    description:
      "Who can open a notebook: without `public` it reads the sharing state — whether " +
      '"anyone with the link" can view, and the people it is shared with (email, name, ' +
      "role). `public: true` turns link viewing on — the user is asked to approve it " +
      "(elicitation), otherwise `confirm: true` is required after the user agreed; " +
      "`public: false` turns it off. Inviting people is not supported (it emails them); " +
      "use the Share dialog in NotebookLM for that.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Library notebook id (from `list_notebooks`)." },
        public: {
          type: "boolean",
          description: "Omit to read. true = anyone with the link can view; false = restricted.",
        },
        confirm: {
          type: "boolean",
          description:
            "public: true only, when the client cannot show an approval prompt: true after " +
            "the user explicitly agreed.",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Notebook link sharing",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "list_notebooks",
    description:
      "List every notebook in the local library with its metadata " +
      "(`id`, `name`, `description`, `topics`, `tags`, `url`, `use_count`, " +
      "etc.). Use the returned `id` for `select_notebook`, `update_notebook`, " +
      "`get_notebook`, `remove_notebook`, or as `notebook_id` on " +
      "`ask_question` / `add_source` / audio tools.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      title: "List notebooks",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_notebook",
    description:
      "Fetch full metadata for one notebook by id. Use to verify what's " +
      "currently stored before calling `update_notebook`, or to show the " +
      "user the exact `description`/`topics`/`use_cases` Claude has for it.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id, as returned by `list_notebooks`/`search_notebooks`.",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Get notebook",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "select_notebook",
    description:
      "Mark a notebook as the active default. After this, `ask_question`, " +
      "`add_source`, and the audio tools resolve to that notebook when the " +
      "caller omits `notebook_id` / `notebook_url`.\n\n" +
      "When to call:\n" +
      "  • The user explicitly switches context (e.g. \"Let's work on " +
      'React now")\n' +
      "  • Task obviously needs a different notebook than the current one — " +
      'announce the switch ("Switching to the React notebook…") before ' +
      "calling.\n" +
      "  • If the right notebook is ambiguous, ask the user first instead " +
      "of guessing.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id to activate (from `list_notebooks`).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Select active notebook",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "update_notebook",
    description:
      "Patch metadata fields on an existing notebook. Pass `id` plus any " +
      "subset of `name`, `description`, `topics`, `content_types`, " +
      "`use_cases`, `tags`, `url` — only supplied fields change.\n\n" +
      "Workflow: identify the target notebook → propose the exact change " +
      "back to the user → call only after explicit confirmation. Multiple " +
      "fields can be updated in one call.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id to update (from `list_notebooks`).",
        },
        name: { type: "string", description: "New display name." },
        description: { type: "string", description: "New 1–2 sentence summary." },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Replacement topics list (full replacement, not append).",
        },
        content_types: {
          type: "array",
          items: { type: "string" },
          description: "Replacement content classification.",
        },
        use_cases: {
          type: "array",
          items: { type: "string" },
          description: "Replacement use-cases.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Replacement tags.",
        },
        url: {
          type: "string",
          description: "New NotebookLM share URL (rarely needed).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Update notebook metadata",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "remove_notebook",
    description:
      "Remove a notebook from the local library. **Does NOT delete the " +
      "actual NotebookLM notebook on Google's side** — only the local " +
      "metadata entry (`delete_notebook` deletes it in the account). Active " +
      "sessions on this notebook are closed.\n\n" +
      "Confirmation workflow: look up the notebook by id, ask the user " +
      "\"Remove '[name]' from your library?\" — only call after a clear yes.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id to remove (from `list_notebooks`).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Remove notebook from library",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "search_notebooks",
    description:
      "Search the library by free-text query — matches against `name`, " +
      "`description`, `topics`, and `tags`. Returns notebook objects with " +
      "their `id` so you can chain into `select_notebook` etc.\n\n" +
      'Use this when the user references a notebook by topic ("the React ' +
      'one") instead of by exact name. If multiple notebooks match, ' +
      "propose the top 1–2 and let the user choose.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords (case-insensitive).",
        },
      },
      required: ["query"],
    },
    annotations: {
      title: "Search notebooks",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_library_stats",
    description:
      "Aggregate statistics about the local notebook library: " +
      "`total_notebooks`, `active_notebook` (id), `most_used_notebook`, " +
      "`total_queries`, `last_modified`. Useful as a quick health check or " +
      'when the user asks "what notebooks do I have?".',
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      title: "Get library statistics",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];
