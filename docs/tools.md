# Tools

Every tool the server registers (38 under the `full` profile), with its parameters, an example where useful, and the return shape. Parameter tables are generated from the live tool schemas.

The server returns each tool result wrapped as `{ "success": true, "data": <object> }` (or `{ "success": false, "error": <string> }`). The shapes below describe the inner `data`.

Many operations use NotebookLM's own data API (`batchexecute` RPCs called from inside the signed-in tab) and fall back to driving the web UI when that API changes. `NOTEBOOKLM_USE_RPC=false` forces the UI path everywhere both exist.

---

## ask_question

Ask a question against a notebook. The question goes to NotebookLM's streamed query endpoint and continues the notebook's server conversation with its history, so follow-ups keep context and the Q&A appears in NotebookLM's own chat. If that endpoint fails, the question is typed into the chat box instead. Pass `session_id` to keep using the same browser tab.

Answers are **Markdown** (e.g. `**bold**`) with `[N]` citation markers; ranges such as `[1-3]` are expanded to `[1][2][3]`. `sources` limits the answer to some sources without changing the notebook's own source selection.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `question` | string | yes | The question to ask NotebookLM. Plain natural language; can be multi-line. Gemini responds grounded on the notebook's sources. |
| `source_format` | `none` / `inline` / `footnotes` / `json` | no | How citations are returned alongside the answer: • `none` (default) — raw answer, no citation extraction (fastest) • `footnotes` — answer plus a `Sources:` block, e.g. `[1] DocName — "excerpt…"` • `inline` — `[N]` markers in the answer are replaced with `[N] (DocName: "excerpt…")` • `json` — answer text untouched; structured `sources` array on the response Use `none` for snappy chat. Use `json` when downstream code needs to process citations programmatically. Use `footnotes`/`inline` when showing the answer to a human reader. |
| `sources` | string[] | no | Answer only from these sources — each entry is a source title (exact or a unique substring) or source id (see `list_sources`). The notebook's own source selection is restored after the answer. Omit to use the current selection (normally all). |
| `browser_options` | object | no | Optional browser behavior settings. Claude can control everything: visibility, typing speed, stealth mode, timeouts. Useful for debugging or fine-tuning. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Example

```json
{
  "name": "ask_question",
  "arguments": {
    "question": "How does the OAuth refresh token rotation work?",
    "notebook_id": "auth-notebook",
    "source_format": "footnotes",
    "sources": ["auth-spec.pdf"]
  }
}
```

### Return shape

```jsonc
{
  "status": "success",
  "question": "How does the OAuth refresh token rotation work?",
  "answer": "[AI-GENERATED …]\n\nThe refresh token is **rotated** on every use [1].\n\nSources:\n[1] auth-spec.pdf — \"Refresh tokens MUST be rotated…\"",
  "session_id": "a1b2c3d4",
  "notebook_url": "https://notebook.google.com/notebook/…",
  "session_info": { "age_seconds": 12, "message_count": 3, "last_activity": 1791190000000 },
  "_provenance": {
    "provider": "google-notebooklm", "model": "gemini-2.5", "via": "chrome-automation",
    "grounding": "user-uploaded-documents", "ai_generated": true
  },
  "source_format": "footnotes",
  "sources": [
    { "marker": "[1]", "number": 1, "sourceName": "auth-spec.pdf", "sourceText": "Refresh tokens MUST be rotated…" }
  ],
  "scoped_sources": ["auth-spec.pdf"]
}
```

`sources` is omitted when `source_format` is `none` or nothing was cited; `scoped_sources` only appears when the call passed `sources`. NotebookLM's canned failure reply ("I'm having trouble responding right now.") is reported as an error.

---

## add_source

Add a source to a notebook: a website (`url`), a YouTube video (`youtube`), pasted text (`text`) or local files (`file`). URLs, videos and text are added through NotebookLM's data API and the call waits (up to 90 s) until NotebookLM has processed them; files are uploaded through the Add-source dialog. To find new sources use [`research_sources`](#research_sources); Google Drive files can be found and imported that way (`corpus: "drive"`). An ambiguous reply is reconciled against the notebook before anything is retried, so a source is never added twice.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `type` | `url` / `youtube` / `text` / `file` | yes | `url` crawls a website, `youtube` imports a video transcript, `text` ingests `content` verbatim, `file` uploads `file_paths`. |
| `content` | string | no | When `type=url`/`youtube`: fully-qualified URL(s) (https://…), several separated by spaces or new lines. When `type=text`: the raw text body (up to NotebookLM's per-source word limit). Not used for `file`. |
| `file_paths` | string[] | no | `type=file` only: absolute paths of local files to upload. |
| `title` | string | no | Display title shown in the source list. Optional — NotebookLM picks a sensible default (page title for URLs, first line for text). For text sources, supplying a title is recommended for later identification. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Example

```json
{
  "name": "add_source",
  "arguments": {
    "type": "url",
    "content": "https://docs.n8n.io/code/builtin/json-jmespath/"
  }
}
```

### Return shape

```jsonc
{
  "result": {
    "success": true,
    "type": "url",
    "sourceCountBefore": 12,
    "sourceCountAfter": 13,
    "sourceIds": ["ee113946-…"],     // data-API path; usable in `sources` arguments
    "message": "Added: n8n JMESPath builtin"
  }
}
```

Local file paths must lie inside the client's roots or `NOTEBOOKLM_FILE_ROOTS`.

---

## research_sources

Run NotebookLM's own source search — the "Search the web for new sources" box: **Fast Research** (about 10 candidates in ~15 s, web or Google Drive) or **Deep Research** (several minutes, dozens of pages plus a written report, web only). It **only returns candidates; nothing is imported.** Vet them, then import the reliable ones with [`import_research_sources`](#import_research_sources).

Every run spends the account's AI usage, Deep Research far more. NotebookLM's picks are often weak — encyclopedia pages, blogs, marketing copy, a repository's landing page instead of the paper — and a loose query makes that worse. So the server:

- refuses queries under 4 words, with advice on writing a precise one (subject + aspect + kind of source + timeframe + region / language);
- answers a query that already ran in this notebook (same mode and corpus; case, spacing and punctuation ignored) from the research history, without a new run (`origin: "reused"`);
- reports a run that is still in progress instead of starting a second one (`origin: "busy"`).

Without `query` it reads the newest run, or `task_id`.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `query` | string | no | The search request. Omit to read the newest run / `task_id`. |
| `mode` | `fast` / `deep` | no | Default `fast`. |
| `corpus` | `web` / `drive` | no | Default `web`; `drive` searches the user's Google Drive (`fast` only). |
| `task_id` | string | no | A run to read (without `query`). |
| `wait_seconds` | number | no | How long to wait for a new run (default 60 fast, 0 deep; max 600). A deep run takes about 4–6 minutes. |
| `include_report` | boolean | no | Deep runs: include the full Markdown report. |
| `all_candidates` | boolean | no | Deep runs list only the candidates the report cites; `true` lists every consulted page. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Example

```json
{
  "name": "research_sources",
  "arguments": {
    "query": "EU AI Act Article 6 high-risk classification — official EU texts and Commission guidelines 2024-2026",
    "mode": "fast"
  }
}
```

### Return shape

```jsonc
{
  "task_id": "2d240123-…",
  "status": "completed",                 // or "running"
  "origin": "started",                   // started | reused | busy | history
  "query": "EU AI Act Article 6 …",
  "mode": "fast",
  "corpus": "web",
  "started_at": "2026-10-06T…Z",
  "summary": "Official texts and guidance on high-risk AI classification.",  // fast
  "report_title": "…", "report_chars": 28798,  // deep; `report` with include_report
  "candidate_count": 10,
  "candidates": [
    {
      "index": 0,
      "url": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
      "title": "Regulation (EU) 2024/1689 (Artificial Intelligence Act)",
      "description": "The regulation's official text.",
      "type": "web",                     // web | google_doc | google_slides | google_sheets | drive_pdf | drive_word
      "imported": false
      // deep runs: "cited": true, "citation": 4, "passage": "…the text the report drew from it…"
    }
  ],
  "next_step": "Vet the candidates …, then import only the reliable ones with import_research_sources."
}
```

---

## import_research_sources

Import vetted candidates of a finished `research_sources` run. **Only reliable references are imported:** every selection needs `reliability` (`high` or `medium`) and a `reason` of at least 20 characters stating why — publisher or author, primary or secondary, date, what it covers for the question. Rejected (and listed in `rejected`): `low` or other ratings, missing or too short reasons, unknown indexes, URLs already in the notebook and domains in `NOTEBOOKLM_RESEARCH_BLOCKED_DOMAINS`.

The call waits until NotebookLM has processed the imports. Each comes back with its metadata and `warnings`: a web, PDF or document source with fewer than 500 indexed words is flagged — possibly a landing page, abstract or paywall rather than the document.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `selections` | object[] | yes | `{ index, reliability: "high" \| "medium", reason }` per candidate. |
| `task_id` | string | no | Research run (default: the newest finished one). |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "taskId": "2d240123-…",
  "imported": [
    {
      "id": "3cc7bbad-…", "title": "High-risk AI systems: classification rules",
      "type": "web", "url": "https://repository.example.edu/record/1234", "words": 460, "characters": 2950,
      "status": "ready", "origin": "research", "addedAt": "…",
      "reliability": "medium", "reason": "…",
      "warnings": ["Only 460 words were indexed — possibly a landing page …"]
    }
  ],
  "rejected": [{ "index": 6, "title": "…", "reason": "reliability \"low\" — only candidates vetted as \"high\" or \"medium\" may be imported …" }],
  "next_step": "Check \"High-risk AI systems …\" with get_source (include_text: true) …"   // when something was flagged
}
```

---

## get_source

Inspect one source for source criticism: metadata, NotebookLM's source guide and — with `include_text` — the text NotebookLM actually indexed, which is what answers are grounded on. That text is not always what the page shows: cookie banners, navigation, a login wall or a landing page end up there too. Read-only.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `source` | string | yes | Source id (from `list_sources`) or a unique part of its title. |
| `include_text` | boolean | no | Also return the indexed text (default false). |
| `offset` | number | no | Text offset in characters (default 0). |
| `max_chars` | number | no | Characters of text to return (default 4000, max 20000). |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "source": {
    "id": "c33daf52-…", "title": "Regulation (EU) 2024/1689 – EUR-Lex",
    "type": "web", "url": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj", "channel": null,
    "words": 10108, "characters": 55550, "status": "ready", "origin": "added",
    "addedAt": "2026-10-04T…Z", "mimeType": null, "driveId": null,
    "guide": { "summary": "The source describes …", "keywords": ["AI Act", "high-risk systems", "…"] },
    "warnings": [],
    "text": { "content": "…", "offset": 0, "totalChars": 73737, "nextOffset": 4000 }   // include_text
  }
}
```

---

## generate_audio

Start a podcast-style Audio Overview. **Non-blocking by default:** returns `status: "started"` at once (or `in_progress` when a render is already running, `ready` when an Audio Overview already exists) — poll `get_audio_status` or `list_studio_artifacts`, then save it with `download_audio` / `download_studio_artifact`. With `wait_for_completion: true` the call waits up to `timeout_ms`, polling in short steps so other calls on the session can run meanwhile. To create another audio when one already exists, use `generate_studio_artifact` with `type: "audio"`.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `custom_prompt` | string | no | Optional focus prompt for the Audio Overview, e.g. "Focus on the API authentication flow and skip pricing". Passed into the NotebookLM "Customize" sub-dialog before generation starts. |
| `format` | `deep_dive` / `brief` / `critique` / `debate` | no | Optional episode format (2026-09 Studio dialog). `deep_dive` = two-host conversation (NotebookLM default), `brief` = bite-sized overview, `critique` = expert review of the sources, `debate` = two hosts debating. |
| `length` | `short` / `default` / `long` | no | Optional episode length. `long` is only offered on some accounts; when unavailable the NotebookLM default is kept. |
| `sources` | string[] | no | Restrict the episode to these sources (title, unique title substring, or source id). Omit to use all sources. |
| `generate_later` | boolean | no | Use NotebookLM's "Generate later" queue instead of "Generate now": does not count against the current limit window, ready within hours. Default false. |
| `wait_for_completion` | boolean | no | If true, block until the audio tile is ready (up to `timeout_ms`). Default false — return immediately and let the caller poll `get_audio_status`. |
| `timeout_ms` | number | no | Only relevant when `wait_for_completion=true`. Maximum wait for the audio tile to appear. Default 600 000 (10 min). |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{ "result": { "status": "started", "message": "Audio Overview generation started. It typically takes 2–10 minutes…" } }
// status: "started" | "in_progress" | "ready" (+ "alreadyExisted": true) | "error"
```

---

## download_audio

Save the most recent Audio Overview to disk as `.m4a`, named after its title. For any other Studio output — or a specific audio by id — use `download_studio_artifact`.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `destination_dir` | string | yes | Absolute directory path where the file is saved (created if missing). Example: `/Users/jane/Downloads/notebooklm` or `/tmp/audio`. Relative paths are NOT recommended — the server may run from a different working directory than the caller. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{ "result": { "success": true, "filePath": "/Users/me/Downloads/notebooklm/Chain_Bridge.m4a" } }
```

The directory must lie inside the client's roots or `NOTEBOOKLM_FILE_ROOTS`.

---

## download_studio_artifact

Save any finished Studio output to disk. It reads NotebookLM's own data API (`batchexecute` RPCs called from inside the signed-in tab) instead of clicking menus, so it takes a second or two per item and does not depend on the UI layout.

| Type | File |
|---|---|
| `audio` | `.m4a` |
| `video` | `.mp4` |
| `infographic` | `.png` |
| `slide_deck` | `.pdf` (default) or `.pptx` |
| `report` | `.md` (interactive reports: not yet — use Export to Docs) |
| `data_table` | `.csv` (UTF-8 with BOM, opens in Excel); `.xlsx` for spreadsheet exports |
| `quiz`, `flashcards` | `.md` (default), `.json` or `.html` |
| `mind_map` | `.json` (`{ name, children }` tree) |

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `destination_dir` | string | yes | Absolute directory, created if missing. Must lie inside the client's roots / `NOTEBOOKLM_FILE_ROOTS` when those are set. |
| `artifact_id` | string | one of | `id` from `list_studio_artifacts`; a unique prefix is enough. |
| `type` | string | one of | Without `artifact_id`: the newest finished item of this type. |
| `format` | string | no | `slide_deck`: `pdf` \| `pptx`. `quiz` / `flashcards`: `markdown` \| `json` \| `html`. |
| `session_id`, `notebook_id`, `notebook_url` | string | no | Notebook targeting, as for the other Studio tools. |

The file is named after the item's title; an existing file is kept and the new one gets a ` (2)` suffix.

### Return shape

```jsonc
{
  "result": {
    "artifact": { "id": "9d728bd3-…", "title": "Chain Bridge", "type": "slide_deck" },
    "file_path": "/Users/me/Downloads/notebooklm/Chain Bridge.pdf",
    "bytes": 14224683,
    "format": "pdf"
  }
}
```

---

## generate_studio_artifact

Start any Studio output: audio, video, slide deck, mind map, report, flashcards, quiz, infographic or data table. Audio, video, infographic, slide deck and document reports are started through NotebookLM's data API (a few seconds, no dialog) whenever every option has a known code and a language is known — the given `language`, else the account's output language (`configure_output_language`). Everything else, "Generate later", and an account on *Default* language use the customise dialog. Generation continues on Google's side; poll `list_studio_artifacts`, then save the result with `download_studio_artifact`.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `type` | `video` / `slide_deck` / `mind_map` / `report` / `flashcards` / `quiz` / `infographic` / `data_table` / `audio` | yes | Studio output type. |
| `prompt` | string | no | Optional focus / description, e.g. "A deck for beginners in a playful style". Ignored for types whose dialog has no free-text field (e.g. report templates). |
| `generate_later` | boolean | no | Use "Generate later" (queued, does not use the current limit window). Default false. |
| `format` | string | no | Per type — audio: deep_dive / brief / critique / debate; video: cinematic / short / explainer; slide_deck: detailed / presenter; report: interactive / document. |
| `length` | `short` / `default` / `long` | no | audio, slide_deck. `long` only where offered. |
| `count` | `fewer` / `standard` / `more` | no | flashcards, quiz: number of cards / questions. |
| `difficulty` | `easy` / `medium` / `hard` | no | flashcards, quiz. |
| `include_images` | boolean | no | flashcards: include images (default true). |
| `orientation` | `landscape` / `portrait` / `square` | no | infographic. |
| `detail` | `concise` / `standard` / `detailed` | no | infographic level of detail (`detailed` is beta). |
| `style` | `auto` / `sketch_note` / `professional` / `bento_grid` / `editorial` / `instructional` / `bricks` / `clay` / `anime` / `kawaii` / `scientific` | no | infographic visual style. |
| `language` | string | no | Output language: a code ("ja"), the name NotebookLM lists ("日本語") or the English name ("Japanese"); all types except video. Defaults to the account's output language (see `configure_output_language`). |
| `sources` | string[] | no | Restrict the output to these sources — each entry is a source title (exact or a unique substring) or source id. Omit to use all sources. The most effective way to make an output accurate: pass only the vetted sources relevant to it. Reports take it with document templates (not the interactive learning overview). |
| `title` | string | no | report only: the report's title, e.g. a suggestion's title from `suggest_reports`. |
| `template` | `learning_overview` / `create_your_own` / `briefing_doc` / `study_guide` / `blog_post` | no | report only. `learning_overview` = interactive report; the others are document reports. A `prompt` is appended to the template's built-in instructions; `create_your_own` uses the prompt alone (required). Default: learning_overview, or create_your_own when `format: document` and a prompt is given; with `sources` the default is briefing_doc (or create_your_own with a prompt). |
| `ask_options` | boolean | no | Show the user a form to choose the options (needs client elicitation support; otherwise the given arguments are used). Default false. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "result": {
    "status": "started",            // | "queued" (Generate later) | "error"
    "message": "slide_deck generation started — poll list_studio_artifacts (id 9d72…).",
    "artifactId": "9d728bd3-…",     // data-API path; matches list_studio_artifacts
    "usagePercent": null,           // dialog path: the usage meter shown in the dialog
    "sources": ["Chain Bridge – Wikipedia"]  // when `sources` was given
  }
}
```

`language` takes a code (`ja`), the name NotebookLM lists (`日本語`) or the English name (`Japanese`). An unknown name is rejected with the list the dialog offers.

---

## suggest_reports

NotebookLM's suggested report formats for a set of sources — the "Suggested Template" cards of the Reports dialog, which NotebookLM derives from the content (a technical analysis, a glossary, a teaching overview …). Each comes with a title, description, audience and a ready-made prompt. Also returns the notebook summary and its suggested questions. Nothing is generated.

Pass the `sources` the report will use — the suggestions are made for exactly those — then generate one with `generate_studio_artifact` (`type: "report"`, `template: "create_your_own"`, the suggestion's `prompt`, its `title` and the same `sources`).

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `sources` | string[] | no | Source titles or ids the report will use. Omit for all sources. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "sources": ["Regulation (EU) 2024/1689 – EUR-Lex", "Commission guidelines on high-risk AI"],
  "suggestions": [
    {
      "title": "Compliance checklist",
      "description": "Step-by-step obligations for providers of high-risk systems.",
      "prompt": "Create a compliance checklist that …",
      "audience": "expert"            // "general" | "expert"
    }
  ],
  "notebook_summary": "The sources describe …",
  "suggested_topics": [{ "question": "Which systems count as high-risk?", "prompt": "Create a detailed briefing document …" }],
  "next_step": "Generate one with generate_studio_artifact …"
}
```

---

## list_studio_artifacts

List the notebook's Studio library — generated outputs and notes — with their status. Read-only; use it to poll a running generation.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "artifacts": [
    { "id": "fc7cfe01-…", "type": "infographic", "title": "Budapest's bridges",
      "details": "11 sources · 4m ago", "status": "ready" }   // | "generating" | "scheduled"
  ]
}
```

---

## list_sources

List the notebook's sources with their ids and whether the chat currently uses each one (`selected`), plus — over the data API — type, URL (or YouTube channel), word and character counts, processing status, origin (`research` when NotebookLM marks it as a research import — web pages and Google Docs, not Word files) and the date added. A web or PDF source with very few words is usually a landing page or paywall; inspect it with [`get_source`](#get_source). Use the ids in `sources` arguments when titles repeat. Read-only.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "count": 11,
  "sources": [
    {
      "id": "c33daf52-…", "title": "Chain Bridge – Wikipedia", "kind": "web", "selected": true,
      "type": "web", "url": "https://en.wikipedia.org/wiki/…", "channel": null,
      "words": 10108, "characters": 55550, "status": "ready", "origin": "added",
      "addedAt": "2026-10-04T…Z"
    }
  ]
}
```

---

## delete_source

**Permanently** remove one source (by id, exact title or unique title substring). The server resolves the target and asks the user for approval through MCP elicitation; clients without elicitation must pass `confirm: true`, set only after the user approved this deletion. Counts as done only after NotebookLM acknowledged it.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `source` | string | yes | Source id, exact title, or unique title substring. |
| `confirm` | boolean | no | Only used when the MCP client cannot show an approval prompt (no elicitation support): then it must be true, set only after explicit user approval. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{ "result": { "deleted": "Old report", "kind": "source" } }
```

---

## delete_studio_artifact

**Permanently** remove a Studio output or a note, with the same approval flow as `delete_source`. Use the id from `list_studio_artifacts` when titles repeat.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Entry id from `list_studio_artifacts` (required to tell identical titles apart), exact title, or unique title substring. |
| `kind` | `note` / `studio_item` | no | Restrict the match to notes or to generated outputs. |
| `confirm` | boolean | no | Only used when the MCP client cannot show an approval prompt (no elicitation support): then it must be true, set only after explicit user approval. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{ "result": { "deleted": "Bridges quiz", "kind": "studio_item" } }   // kind: "studio_item" | "note"
```

---

## rename_source

Renames a source (sidebar → More → "Rename source"; RPC `b7Wfje`, verified from the reply). The tab is reloaded so UI-based reads show the new title.

| Name | Type | Required | Notes |
|---|---|---|---|
| `source` | string | yes | Source id, exact title, or unique title substring. |
| `title` | string | yes | New title. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting. |

Returns `{ id, from, to }`.

---

## rename_studio_artifact

Renames a Studio output (item menu → "Rename"; RPC `rc3d8d`). Notes are not covered.

| Name | Type | Required | Notes |
|---|---|---|---|
| `artifact` | string | yes | Item id (or unique prefix) from `list_studio_artifacts`, exact title, or unique title substring. |
| `title` | string | yes | New title. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting. |

Returns `{ id, type, from, to }`.

---

## get_studio_artifact

NotebookLM's "View prompt and sources" for one Studio output, read from the Studio library data (no dialog).

| Name | Type | Required | Notes |
|---|---|---|---|
| `artifact` | string | yes | Item id (or unique prefix), exact title, or unique title substring. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting. |

```jsonc
{
  "id": "d312f03f-…", "title": "Chain Bridge Evolution", "type": "slide_deck",
  "status": "ready", "prompt": "Három dia a Lánchíd történetéről.", "language": "hu",
  "template": null,            // report template ("Study Guide", "Custom Report", …)
  "createdAt": "2026-10-05T08:59:33.000Z",
  "sourceIds": ["c33daf52-…"],
  "sources": [{ "id": "c33daf52-…", "title": "Széchenyi lánchíd – Wikipédia" }]  // title null = source deleted since
}
```

`prompt` is null when the output was generated without instructions, and for data tables (their prompt is not stored where it can be read).

---

## save_answer_as_note

Pin a chat answer as a note in the Studio panel ("Save to note") — the latest answer, or the answer to `question`. When the latest answer was asked through the data API, the tab is reloaded first so the right answer is saved.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `question` | string | no | Question whose answer to save. Omit for the latest answer. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "note": {
    "title": "The Chain Bridge's lions",
    "preview": "The stone lions were carved by János Marschalkó…",
    "question": "Who carved the stone lions?",
    "answerStart": "The stone lions were carved by János Marschalkó…"
  }
}
```

---

## convert_note_to_source

Turn a note (or all notes) into a source, so the chat and Studio can use it.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `note_title` | string | no | Note title (exact, or a unique substring). Required unless `all` is true. |
| `all` | boolean | no | Convert all notes. Default false. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{ "result": { "converted": "The Chain Bridge's lions", "sourceCountBefore": 11, "sourceCountAfter": 12 } }
```

---

## configure_chat

Read or change the notebook's persistent chat configuration ("Configure Chat": goal, custom prompt, response length). Omitted fields keep their value; call without arguments to read. Read and written through the data API (verified by reading back), with the dialog as fallback.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `goal` | `default` / `learning_guide` / `custom` | no | Conversational goal. Omit to keep the current one. |
| `custom_prompt` | string | no | System instruction for the notebook (role, style, tone, output rules), e.g. "You are a senior code reviewer. Answer in German, max 5 bullet points." Implies goal "custom" when `goal` is omitted. Max 10 000 chars. Replaces the previous instruction. |
| `response_length` | `default` / `longer` / `shorter` | no | Answer length. Omit to keep the current one. |
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "config": {
    "goal": "custom",               // "default" | "learning_guide" | "custom"
    "length": "longer",             // "default" | "longer" | "shorter"
    "customPrompt": "Answer in one sentence, in German.",
    "saved": true                   // false for a read or when nothing changed
  }
}
```

NotebookLM keeps a custom prompt stored when the goal is switched back to `default`; it is just inactive.

---

## configure_output_language

Read or set the **account's** output language (Settings → Output language). It decides the language of answers and of Studio outputs that do not name one, for every notebook of the account — also in the NotebookLM web app. With *Default*, NotebookLM uses its interface language, which is English for this server, so a user expecting another language gets English; set an override (after asking the user).

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `language` | string | no | Language to set; "default" removes the override. Omit to read. |

### Return shape

```jsonc
{
  "language": "ja",                 // null = Default
  "name": "日本語",
  "previous": "en",
  "changed": true,
  "note": "Default: NotebookLM answers and generates in its interface language…"  // only when null
}
```

`language` accepts a code (`ja`), the listed name (`日本語`), the English name (`Japanese`) or `default`.

---

## get_usage

Read the AI usage windows: a short rolling window (resets every few hours) and a weekly limit. Read through the data API; if that changes, the Settings → Usage dialog is read instead (then `resets` is the dialog text).

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{
  "usage": {
    "windows": [
      { "label": "Current Gemini Notebook AI usage", "percentUsed": 28.4, "resets": "2026-10-05T11:57:24.000Z" },
      { "label": "Weekly limit", "percentUsed": 2.2, "resets": "2026-10-11T15:57:24.000Z" }
    ],
    "raw": "…"
  }
}
```

---

## get_audio_status

Non-blocking probe of the notebook's Audio Overview, for polling after `generate_audio`.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `session_id`, `notebook_id`, `notebook_url`, `show_browser` | — | no | Notebook targeting, as for the other session tools. |

### Return shape

```jsonc
{ "result": { "status": "in_progress" } }   // "ready" | "in_progress" | "not_started" | "error"
```

---

## add_notebook

Add a NotebookLM share-URL to the local library. The tool description enforces a confirmation workflow on the host agent — do not call without explicit user consent.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | NotebookLM share URL. |
| `name` | string | yes | Display name. |
| `description` | string | yes | Short description of the notebook content. |
| `topics` | string[] | yes | Topics covered. |
| `content_types` | string[] | no | e.g. `["documentation", "examples"]`. |
| `use_cases` | string[] | no | When to consult this notebook. |
| `tags` | string[] | no | Optional organizational tags. |

### Return shape

```jsonc
{
  "status": "added",
  "id": "nb_abcd",
  "name": "n8n Documentation",
  "active": true
}
```

---

## import_account_notebooks

Read the signed-in account's notebooks from the NotebookLM homepage ("My notebooks" / "Shared with me") and add the ones not yet in the local library — no share-links needed. Notebooks already in the library (matched by the UUID in the URL) are skipped, so repeated runs are safe; Featured / Discover notebooks are never imported. Imported entries get a placeholder description and no topics — fill them in with `update_notebook`.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `scope` | `"mine"` \| `"shared"` \| `"all"` | no | Default `"mine"`. |
| `query` | string | no | Only titles containing this text (case-insensitive). |
| `notebook_ids` | string[] | no | Only these notebooks — `uuid` values from a dry run, or notebook URLs. |
| `dry_run` | boolean | no | List without changing the library. Default `false`. |

### Return shape

```jsonc
{
  "dry_run": false,
  "scope": "mine",
  "found": 12,              // notebooks on the homepage for the scope
  "matched": 12,            // after query / notebook_ids
  "imported": 11,
  "already_in_library": 1,
  "active_notebook_id": "n8n-documentation",
  "notebooks": [
    {
      "status": "imported",         // | "would_import" (dry run) | "already_in_library"
      "library_id": "react-hooks",  // null for would_import
      "name": "React Hooks",
      "uuid": "<notebook-uuid>",
      "url": "https://notebook.google.com/notebook/<notebook-uuid>",
      "sources": 8,
      "created_at": "2026-05-07T18:29:16.000Z",
      "scope": "mine"
    }
  ],
  "next_step": "Imported notebooks have only a placeholder description …"
}
```

---

## list_notebooks

No parameters. Returns the full library.

### Return shape

```jsonc
{
  "active_notebook_id": "nb_abcd",
  "notebooks": [
    {
      "id": "nb_abcd",
      "name": "n8n Documentation",
      "url": "https://notebook.google.com/notebook/…",
      "description": "n8n core + builtin nodes",
      "topics": ["workflow automation", "n8n"],
      "use_cases": ["building n8n workflows"],
      "tags": ["docs"],
      "use_count": 42
    }
  ]
}
```

---

## get_notebook

| Name | Type | Required |
|---|---|---|
| `id` | string | yes |

Returns one entry from `list_notebooks`.

---

## select_notebook

Set a notebook as the active default.

| Name | Type | Required |
|---|---|---|
| `id` | string | yes |

### Return shape

```jsonc
{ "status": "active", "id": "nb_abcd", "name": "n8n Documentation" }
```

---

## update_notebook

| Name | Type | Required |
|---|---|---|
| `id` | string | yes |
| `name` | string | no |
| `description` | string | no |
| `topics` | string[] | no |
| `content_types` | string[] | no |
| `use_cases` | string[] | no |
| `tags` | string[] | no |
| `url` | string | no |

Returns the updated entry.

---

## remove_notebook

Removes the entry from the local library only — does not delete the notebook in NotebookLM (use `delete_notebook` for that).

| Name | Type | Required |
|---|---|---|
| `id` | string | yes |

---

## create_notebook

Creates a new, empty notebook in the signed-in Google account (RPC `CCqFvf`), adds it to the library and, unless `select: false`, makes it the active notebook.

| Name | Type | Required |
|---|---|---|
| `title` | string | yes |
| `description` | string | no |
| `topics` | string[] | no |
| `use_cases` | string[] | no |
| `tags` | string[] | no — default `["created", "own"]` |
| `select` | boolean | no — default `true` |

Returns the library entry, the NotebookLM `uuid` and `selected`.

---

## rename_notebook

Renames the notebook in NotebookLM itself (RPC `s0tc2d`, verified from the reply) and updates the library name. `update_notebook` changes only the local name.

| Name | Type | Required |
|---|---|---|
| `id` | string | yes — library id |
| `title` | string | yes |

---

## delete_notebook

**Permanently** deletes the notebook from the Google account — sources, notes and Studio outputs included (RPC `WWINqb`, verified by re-reading the account's notebook list) — closes its sessions and removes the library entry. When the client supports elicitation the user is asked directly; otherwise `confirm: true` is required.

| Name | Type | Required |
|---|---|---|
| `id` | string | yes — library id |
| `confirm` | boolean | only without elicitation |

---

## pin_notebook

Pins a notebook to the top of the homepage, or unpins it (RPC `LQhfEb`, verified from the reply).

| Name | Type | Required |
|---|---|---|
| `id` | string | yes — library id |
| `pinned` | boolean | no — default `true` |

---

## list_collections

No parameters. The account's collections (homepage → Collections; RPC `I3xc3c`): `id`, `name`, `emoji` and `notebooks` — each with `uuid`, `title` and `library_id` (null when the notebook is not in the library).

---

## manage_collection

| Name | Type | Required | Notes |
|---|---|---|---|
| `action` | `create` / `update` / `delete` | yes | |
| `collection` | string | update, delete | Collection id or exact name. |
| `name` | string | create; optional for update | Name / new name. |
| `add_notebooks` | string[] | no | Library ids, notebook URLs or UUIDs. |
| `remove_notebooks` | string[] | no | update only. |
| `confirm` | boolean | delete without elicitation | |

Create uses RPC `agX4Bc`, changes `le8sX` (one notebook per call, as the "Add to collection" dialog does), delete `GyzE7e`; every change is verified by re-reading the collections. Deleting a collection keeps its notebooks and asks the user first.

---

## share_notebook

Reads or changes link sharing (RPCs `JFMDGd`, `QDyure`).

| Name | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Library id. |
| `public` | boolean | no | Omit to read; `true` = anyone with the link can view (asks the user); `false` = restricted. |
| `confirm` | boolean | `public: true` without elicitation | |

Returns `public`, `people` (`email`, `name`, `role`: owner / editor / viewer), `url` and `changed`. Inviting people is not supported — it sends them email.

---

## search_notebooks

Searches name, description, topics, tags.

| Name | Type | Required |
|---|---|---|
| `query` | string | yes |

Returns an array of matching entries.

---

## get_library_stats

No parameters. Returns total notebooks, total queries, top-used notebooks.

---

## list_sessions

No parameters. Returns the browser sessions (tabs) of this server.

```jsonc
{
  "active_sessions": 2, "max_sessions": 10, "session_timeout": 900,
  "oldest_session_seconds": 312, "total_messages": 5,
  "sessions": [
    {
      "id": "a1b2c3d4", "created_at": 1791190000000, "last_activity": 1791190300000,
      "age_seconds": 312, "inactive_seconds": 4, "message_count": 3,
      "notebook_url": "https://notebook.google.com/notebook/…",
      "current_operation": "ask_question",  // tool call driving this tab, or null
      "queued_operations": 1                 // calls waiting for it — one at a time per session
    }
  ]
}
```

Idle sessions older than `session_timeout` are closed automatically; busy ones are kept.

---

## close_session

| Name | Type | Required |
|---|---|---|
| `session_id` | string | yes |

---

## reset_session

Clears chat history while keeping the same `session_id`.

| Name | Type | Required |
|---|---|---|
| `session_id` | string | yes |

---

## get_health

No parameters.

### Return shape

```jsonc
{
  "status": "ok",
  "authenticated": true,
  "active_sessions": 1,
  "version": "2.0.0",
  "config": {
    "headless": true,
    "stealth_enabled": true,
    "max_sessions": 10,
    "answer_timeout_ms": 600000
  }
}
```

When `authenticated=false` the response also carries a `troubleshooting_tip` pointing at `setup_auth` / `cleanup_data`.

---

## setup_auth

Opens a visible Chrome for first-time Google login.

| Name | Type | Required | Notes |
|---|---|---|---|
| `show_browser` | bool | no | Default `true` for setup. |
| `browser_options` | object | no | Same shape as `ask_question`. |

Returns immediately after the window is opened. The user has up to 10 minutes to complete the login. Verify with `get_health` afterwards.

---

## re_auth

Closes all sessions, deletes saved cookies + Chrome profile, opens a fresh login window.

| Name | Type | Required | Notes |
|---|---|---|---|
| `show_browser` | bool | no | Default `true`. |
| `browser_options` | object | no | |

---

## cleanup_data

Categorised preview + delete of every NotebookLM MCP file the server can find on the system. Designed for fresh-start workflows.

| Name | Type | Required | Notes |
|---|---|---|---|
| `confirm` | bool | yes | `false` = preview only. `true` = delete after preview was reviewed. |
| `preserve_library` | bool | no | Keep `library.json` while wiping everything else. Default `false`. |

Workflow:

1. `cleanup_data({ confirm: false, preserve_library: true })` — see what will be deleted.
2. Close all Chrome instances.
3. `cleanup_data({ confirm: true, preserve_library: true })` — execute.

---

## list_prompt_templates

Search the bundled prompt templates (and user packs from `NOTEBOOKLM_PROMPT_DIRS`). Each template targets one action: a chat question, a `configure_chat` instruction or a Studio type. Returns summaries; fetch the text with `get_prompt_template`. Local, read-only.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `query` | string | no | Keywords, e.g. "debate podcast" or "executive deck". |
| `target` | `ask` / `configure_chat` / `audio` / `video` / `slide_deck` / `mind_map` / `report` / `flashcards` / `quiz` / `infographic` / `data_table` | no | Only templates for this action. |
| `pack` | string | no | Only this pack (e.g. browser-plugin, learner-pack). |
| `lang` | string | no | Only templates available in this language (en, hu …). |
| `limit` | number | no | Page size, 1–100. Default 20. |
| `offset` | number | no | Results to skip, for paging. Default 0. |

### Return shape

```jsonc
{
  "total": 6, "offset": 0,
  "templates": [
    { "name": "pa-studio-audio-brief-executive-summary", "title": "Brief - Executive Summary",
      "target": "audio", "pack": "browser-plugin", "langs": ["en", "hu"], "level": "intermediate",
      "category": "studio", "description": "[audio] Quick summary to share findings…" }
  ]
}
```

---

## get_prompt_template

Return one template's text (in `lang` when available) and instructions for using it. Does not run anything in NotebookLM — call the named tool afterwards.

### Parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Template name from `list_prompt_templates`. |
| `lang` | string | no | Preferred language (en, hu …). Default en. |
| `topic` | string | no | Learner-pack templates: the topic (required there). |
| `lens` | string | no | Learner-pack templates: eli5, newbie, clinical, operator, finance, deep_dive. |
| `context` | string | no | Details for the template's [BRACKETED] placeholders. |
| `notebook` | string | no | Library notebook id or notebook URL. |

### Return shape

```jsonc
{
  "name": "pa-studio-infographic-infographic-brutalist-editorial", "title": "…", "target": "infographic",
  "pack": "browser-plugin", "langs": ["en", "hu"], "description": "…",
  "lang": "hu",            // language of the returned text
  "text": "…",              // the prompt to paste into the named tool
  "instructions": "…",      // how to use it, with the goal and the tool contract
  "source": "https://…", "license": "MIT"
}
```

---

## Resources (read-only)

| URI | Purpose |
|---|---|
| `notebooklm://library` | JSON view of the full library. |
| `notebooklm://library/{id}` | One notebook by ID. The `{id}` template autocompletes from the library. |
| `notebooklm://metadata` | Deprecated. Use `notebooklm://library` instead. |

The MCP server does not respond to `mcp://notebooklm` — that URI scheme never existed. Use `notebooklm://`.
