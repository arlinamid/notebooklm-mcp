# Usage Guide

Practical end-to-end walkthroughs for v3.2. Each section is a self-contained recipe with the exact tool calls / curl commands.

- [First-time setup](#first-time-setup)
- [Multi-turn session pattern](#multi-turn-session-pattern)
- [Finding and vetting sources](#finding-and-vetting-sources)
- [Citations workflow](#citations-workflow)
- [Audio Overview generation + download](#audio-overview-generation--download)
- [Studio outputs: generate, wait, download](#studio-outputs-generate-wait-download)
- [Output language](#output-language)
- [Multi-account switching](#multi-account-switching)
- [HTTP transport for n8n / Zapier](#http-transport-for-n8n--zapier)

---

## First-time setup

### 1. Install and start

```bash
npx @arlinamid/notebooklm-mcp@latest
```

Wire it into your MCP client of choice (see the [README](../README.md#connect-to-claude-code)).

### 2. Authenticate

Call `setup_auth`. A Chrome window opens. Log in to the Google account that owns the NotebookLM notebooks you want to query. Close the browser when done.

```json
{ "name": "setup_auth", "arguments": {} }
```

Verify:

```json
{ "name": "get_health", "arguments": {} }
```

Expect `"authenticated": true`.

### 3. Add a notebook to the local library

Notebooks of the signed-in account can be imported in one go — no share links needed. Preview first, then import all of them or a selection:

```json
{ "name": "import_account_notebooks", "arguments": { "dry_run": true, "scope": "all" } }
{ "name": "import_account_notebooks", "arguments": { "notebook_ids": ["<uuid from the dry run>"] } }
```

Imported entries get a placeholder description; fill it in with `update_notebook`.

For a notebook of another account, get a share-URL: open it on `notebook.google.com`, click _Share → Anyone with the link → Copy link_. Then:

```json
{
  "name": "add_notebook",
  "arguments": {
    "url": "https://notebook.google.com/notebook/abcd-efgh",
    "name": "n8n Documentation",
    "description": "n8n core docs + builtin nodes",
    "topics": ["workflow automation", "n8n", "node configuration"],
    "use_cases": ["building n8n workflows", "debugging n8n executions"],
    "tags": ["docs", "n8n"]
  }
}
```

### 4. Ask the first question

```json
{
  "name": "ask_question",
  "arguments": {
    "question": "What is the recommended retry pattern for the HTTP Request node?"
  }
}
```

Capture `session_id` from the response — you will reuse it for follow-ups.

---

## Multi-turn session pattern

Reusing `session_id` keeps NotebookLM's conversational context. The browser session also stays open, so each follow-up is faster.

```json
// 1. Open broad — captures session_id
{ "name": "ask_question", "arguments": {
  "question": "Give me an overview of the n8n error handling architecture."
}}
// → response.session_id = "ses_abc123"

// 2. Drill in
{ "name": "ask_question", "arguments": {
  "question": "What's the recommended retry/backoff pattern for HTTP nodes?",
  "session_id": "ses_abc123"
}}

// 3. Edge cases
{ "name": "ask_question", "arguments": {
  "question": "Common pitfalls when retrying webhook-triggered workflows?",
  "session_id": "ses_abc123"
}}

// 4. Production sample
{ "name": "ask_question", "arguments": {
  "question": "Show me a production example combining retry + circuit-breaker.",
  "session_id": "ses_abc123"
}}
```

When the task changes, either:

- Reset the same session: `{ "name": "reset_session", "arguments": { "session_id": "ses_abc123" } }`
- Close it: `{ "name": "close_session", "arguments": { "session_id": "ses_abc123" } }` — and start a new one with no `session_id`.

Sessions auto-expire after `SESSION_TIMEOUT` seconds of inactivity (default `900` = 15 min).

---

## Finding and vetting sources

Answers, audio and slides can only be as good as the sources, and NotebookLM's own search often brings weak ones. Vet before you build on them.

### 1. Check what is there

```json
{ "name": "list_sources", "arguments": {} }
```

Each source has `type`, `url`, `words` and `origin`. A web page or PDF with a few hundred words is usually a landing page, abstract or paywall. Look inside:

```json
{ "name": "get_source", "arguments": { "source": "Reconstruction of the Széchenyi", "include_text": true, "max_chars": 3000 } }
```

`guide` is NotebookLM's own summary and keywords; `text` is what answers are grounded on.

### 2. Search with one precise query

Every run spends AI usage. Name the subject, the aspect, the kind of source and the timeframe:

```json
{ "name": "research_sources", "arguments": {
  "query": "EU AI Act Article 6 high-risk classification — official EU texts and Commission guidelines 2024-2026"
}}
```

Use `mode: "deep"` only for a broad survey (it runs for minutes and returns at once with `running`; call again without `query` later). The same query again costs nothing: it is answered from the notebook's research history.

### 3. Import only what passes

Open a candidate's URL when title and description are not enough. Then import the reliable ones, each with a reason:

```json
{ "name": "import_research_sources", "arguments": { "selections": [
  { "index": 0, "reliability": "high", "reason": "EUR-Lex consolidated text of the regulation — primary legal source, current version." },
  { "index": 4, "reliability": "medium", "reason": "European Commission Q&A page on high-risk systems, 2025; official but secondary." }
]}}
```

Check every `warnings` entry with `get_source`; replace a landing page with the full-text URL (`add_source`). Then work from the vetted subset — `sources` on `ask_question` and the Studio tools.

To keep certain sites out for good, set `NOTEBOOKLM_RESEARCH_BLOCKED_DOMAINS`, e.g. `scribd.com,pinterest.com`.

---

## Citations workflow

Set `source_format` on `ask_question`. Four modes:

### `none` (default)

Raw answer. No `sources` field.

### `inline`

```json
{ "name": "ask_question", "arguments": {
  "question": "How does refresh-token rotation work?",
  "source_format": "inline"
}}
```

`[1]` markers in the answer text get replaced with `(source name — short excerpt)` inline.

### `footnotes`

```json
{ "name": "ask_question", "arguments": {
  "question": "How does refresh-token rotation work?",
  "source_format": "footnotes"
}}
```

Response (abridged):

```jsonc
{
  "answer": "[AI-GENERATED ...] Refresh tokens are rotated on every refresh request [1]. The previous token is revoked server-side [2].\n\nSources:\n[1] auth-spec.pdf — \"Refresh tokens MUST be rotated…\"\n[2] auth-spec.pdf — \"On rotation, the previous token MUST be invalidated…\"",
  "sources": [
    { "index": 1, "title": "auth-spec.pdf", "excerpt": "Refresh tokens MUST be rotated…" },
    { "index": 2, "title": "auth-spec.pdf", "excerpt": "On rotation, the previous token MUST be invalidated…" }
  ],
  "source_format": "footnotes"
}
```

### `json`

Answer text is left untouched. Citations are returned only as a structured array on `sources`. Use this when you want to render citations yourself.

---

## Audio Overview generation + download

Three steps: start, wait, download.

### 1. Start

```json
{
  "name": "generate_audio",
  "arguments": { "custom_prompt": "Focus on the migration steps and breaking changes", "format": "brief" }
}
```

This returns at once with `status: "started"`. Rendering takes 2–10 minutes on Google's side; meanwhile the session stays usable for questions. (`wait_for_completion: true` waits inside the call instead, up to `timeout_ms`.)

### 2. Wait

Poll every ~30 s until `status` is `ready`:

```json
{ "name": "get_audio_status", "arguments": {} }
```

### 3. Download

```json
{ "name": "download_audio", "arguments": { "destination_dir": "/Users/me/Downloads/notebooklm" } }
```

The result has the absolute `filePath` of the `.m4a`. If you call `download_audio` before any Audio Overview exists, it returns an error pointing at `generate_audio`.

---

## Studio outputs: generate, wait, download

Any Studio type works the same way — here an infographic in Hungarian, square, from one source:

```json
{
  "name": "generate_studio_artifact",
  "arguments": {
    "type": "infographic", "prompt": "The city's bridges at a glance",
    "orientation": "square", "detail": "concise", "style": "professional",
    "language": "hu", "sources": ["Chain Bridge – Wikipedia"]
  }
}
```

The result carries the new item's `artifactId`. Poll `list_studio_artifacts` until that item is `ready`, then save it:

```json
{ "name": "download_studio_artifact", "arguments": { "artifact_id": "<artifactId>", "destination_dir": "/Users/me/Downloads/notebooklm" } }
```

Slide decks download as PDF (`format: "pptx"` for PowerPoint), reports as Markdown, data tables as CSV, quizzes and flashcards as Markdown or JSON, mind maps as JSON. Without `artifact_id`, `type` picks the newest finished item of that type.

---

## Output language

Answers and Studio outputs follow the **account's** output language. Check it:

```json
{ "name": "configure_output_language", "arguments": {} }
```

`language: null` means *Default*: NotebookLM then uses its interface language, which is English for this server — a Hungarian user would get English. Set it (it is an account setting, also in the web app, so ask the user first):

```json
{ "name": "configure_output_language", "arguments": { "language": "magyar" } }
```

A single Studio output can override it with `language` (`hu`, `magyar` or `Hungarian` all work).

---

## Multi-account switching

Run two parallel installations against different Google accounts:

```bash
# Terminal A: work account
npx @arlinamid/notebooklm-mcp@latest --account work

# Terminal B: personal account
npx @arlinamid/notebooklm-mcp@latest --account personal
```

Each account gets its own Chrome profile under `<dataDir>/accounts/<name>/`. The first run for a new account requires its own `setup_auth`. Switching is just a matter of starting the server with a different `--account` flag (or `NOTEBOOKLM_ACCOUNT` env).

Use cases:

- Working notebooks on a corporate Google account, side-projects on a personal one.
- Rotating between two free-tier accounts when one account's usage window is exhausted (`get_usage`).

Several MCP clients on the **same** account (e.g. Claude Desktop's chat and Code tab) need nothing special: the first server instance owns the browser and the others forward to it — see the README, "Several clients on one account".

There is no shared library between accounts — each account has its own `library.json`. If you want the same library across accounts, copy `library.json` between the two `accounts/<name>/` directories manually.

---

## HTTP transport for n8n / Zapier

Start the server in HTTP mode:

```bash
npx @arlinamid/notebooklm-mcp@latest --transport http --port 3000 --host 0.0.0.0
```

The two operations:

| Method | Path |
|---|---|
| `POST` | `/mcp` |
| `GET` | `/healthz` |

### 1. Initialize a session

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0.0.1" }
    }
  }'
```

Capture the `Mcp-Session-Id` response header. Pass it as a request header on every subsequent call.

### 2. Ask a question

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Mcp-Session-Id: <session-id-from-step-1>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "ask_question",
      "arguments": {
        "question": "What is the n8n Code node best for?",
        "source_format": "footnotes"
      }
    }
  }'
```

The response is the standard MCP `tools/call` envelope. The actual tool output lives under `result.content[0].text` as a JSON string.

### Liveness probe

```bash
curl http://localhost:3000/healthz
# {"status":"ok","protocol":"mcp-streamable-http"}
```

### Notes

- The default bind address is `127.0.0.1`. Bind to `0.0.0.0` only on a trusted network.
- Sessions are kept in process memory; restarting the server invalidates all sessions.
- For n8n, Zapier, and similar HTTP-only callers, an "HTTP Request" node configured with a per-execution session-id store is enough — initialize once at workflow start, reuse the session for the rest of the run, and let the `DELETE /mcp` route close it cleanly at the end.
