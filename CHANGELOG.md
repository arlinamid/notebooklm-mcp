# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-10-04

First release after taking over development from the archived upstream
([PleasePrompto/notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp)),
now at [arlinamid/notebooklm-mcp](https://github.com/arlinamid/notebooklm-mcp) and
published as **`@arlinamid/notebooklm-mcp`**. Restores compatibility with the
September 2026 "Gemini Notebook" redesign and adds tools for the features it
introduced.

**Upgrading:** replace `notebooklm-mcp@latest` with
`@arlinamid/notebooklm-mcp@latest` in the MCP client configuration. The
`notebooklm-mcp` command, tool names, settings and data directory (Chrome
profile, auth state, library) are unchanged, so existing logins carry over.
The major version marks the new package and maintainer; no tool or parameter
was removed.

Verified live against notebook.google.com (EN locale) through the MCP server:
chat, citations, source scoping, every `add_source` type, Studio generation
(audio, mind map; quiz and report queued via "Generate later"), audio
status/download, notes → sources, `configure_chat`, `get_usage` and the
prompt templates. Deletion was verified in a dry run with all writes blocked
and then run live by the user (duplicate sources and notes removed).
Video, slide-deck, infographic and data-table generation share the verified
dialog code but were not submitted live. The MCP protocol features below were
tested with SDK 1.32 client scripts against the live site. These covered tasks
(incl. cancel and a mind-map task), cancellation, progress, roots,
elicitation, sampling, logging, subscriptions and output-schema validation.

The open bug reports against 2.0.0 in the archived upstream tracker were
re-checked against this release:

| Upstream issues | Problem | How it was checked in 3.0.0 |
|---|---|---|
| [#114](https://github.com/PleasePrompto/notebooklm-mcp/issues/114), [#116](https://github.com/PleasePrompto/notebooklm-mcp/issues/116) | Stale answer to an earlier question | Nonce test in fresh sessions on a notebook with long chat history: 3 of 3 correct |
| [#48](https://github.com/PleasePrompto/notebooklm-mcp/issues/48) | Citation tooltip blocks a follow-up question | Verified live |
| [#45](https://github.com/PleasePrompto/notebooklm-mcp/issues/45) | Startup banner printed to stdout | Banner goes to stderr; stdout carries only JSON-RPC |
| [#76](https://github.com/PleasePrompto/notebooklm-mcp/issues/76), [#83](https://github.com/PleasePrompto/notebooklm-mcp/issues/83), [#95](https://github.com/PleasePrompto/notebooklm-mcp/issues/95), [#102](https://github.com/PleasePrompto/notebooklm-mcp/issues/102), [#107](https://github.com/PleasePrompto/notebooklm-mcp/issues/107), [#108](https://github.com/PleasePrompto/notebooklm-mcp/issues/108), [#113](https://github.com/PleasePrompto/notebooklm-mcp/issues/113) | Login detection on the new host | Fixed (new host) |
| [#74](https://github.com/PleasePrompto/notebooklm-mcp/issues/74), [#78](https://github.com/PleasePrompto/notebooklm-mcp/issues/78), [#84](https://github.com/PleasePrompto/notebooklm-mcp/issues/84) | Thinking text returned instead of the answer | Fixed |
| [#63](https://github.com/PleasePrompto/notebooklm-mcp/issues/63), [#85](https://github.com/PleasePrompto/notebooklm-mcp/issues/85), [#93](https://github.com/PleasePrompto/notebooklm-mcp/issues/93), [#111](https://github.com/PleasePrompto/notebooklm-mcp/issues/111) | Add-source dialog | Fixed |

Not verified, and still possible:
- orphan Chrome processes after a failed call
  ([#94](https://github.com/PleasePrompto/notebooklm-mcp/issues/94));
- `BROWSER_CHANNEL=chromium` login staying on about:blank
  ([#112](https://github.com/PleasePrompto/notebooklm-mcp/issues/112));
- answer timeouts on very large notebooks
  ([#50](https://github.com/PleasePrompto/notebooklm-mcp/issues/50),
  [#103](https://github.com/PleasePrompto/notebooklm-mcp/issues/103));
- Korean UI selectors
  ([#69](https://github.com/PleasePrompto/notebooklm-mcp/issues/69),
  [#72](https://github.com/PleasePrompto/notebooklm-mcp/issues/72)).

### Added

- **`generate_studio_artifact`** — create any Studio output: video, slide
  deck, mind map, report, flashcards, quiz, infographic, data table (and
  audio). Fills the optional focus prompt and submits with "Generate now", or
  "Generate later" (`generate_later: true`, queued outside the current limit
  window). Returns the usage-meter reading from the dialog.
- **`list_studio_artifacts`** — Studio library with `type`, `title`,
  `details` and `status` (`ready` | `generating` | `scheduled`).
- **`get_usage`** — reads Settings → Usage: the rolling usage window and the
  weekly limit (percent used + reset time). Replaces the outdated
  "50 queries/day" model in all messages and descriptions.
- **`configure_chat`** — read or set the notebook's persistent system
  instruction ("Configure Chat": goal default / learning guide / custom
  prompt, response length). Shapes every later answer on the notebook.
- **`generate_audio`**: new optional `format` (`deep_dive`, `brief`,
  `critique`, `debate`), `length`, `sources` and `generate_later` arguments.
- **Studio options** on `generate_studio_artifact`, mapped to language-free
  anchors (radio `value`s, toggle positions): video/slide formats,
  infographic style/orientation/detail, flashcard & quiz count/difficulty,
  output `language`, and the report flow (Interactive/Document format,
  templates; a `prompt` is appended to the template's instructions or used
  alone for `create_your_own`). Unsupported option/type combinations are
  rejected before anything is clicked.
- **Source scoping** (`sources`) for Studio jobs (per-dialog source picker)
  and for `ask_question` (sidebar selection, restored after the answer).
  **`list_sources`** returns stable source ids for duplicate titles.
- **MCP prompts.** The server declared the `prompts` capability but had no
  `prompts/list` handler (clients got "method not found"). It now serves
  curated templates from two bundled MIT packs (Prompt Architect for
  NotebookLM, EN + HU; NotebookLM Learner Pack, topic + audience lens) and
  from user directories (`NOTEBOOKLM_PROMPT_DIRS`, `<data dir>/prompt-packs`).
  Each renders to one goal-and-contract message naming the tool to call;
  identical / near-identical templates are folded (aliases stay resolvable);
  argument completion covers `lang`, `lens` and `notebook`. Tools
  `list_prompt_templates` / `get_prompt_template` expose the same templates
  to clients without prompt support. `scripts/import-prompt-packs.mjs`
  refreshes the packs (pinned commits, licenses in
  `prompts/THIRD_PARTY_NOTICES.md`).
- **More source types** in `add_source`: `file` (local uploads via the
  dialog's file chooser, several files per call), `youtube`, and several
  URLs per `url` call. Missing files / empty content fail fast.
- **`delete_source`** and **`delete_studio_artifact`** (Studio outputs and
  notes) — permanent. The server asks the *user* for approval via MCP
  elicitation, naming the resolved entry ("Permanently delete the source
  "X"…?"); decline, dismiss or an unticked box leaves everything untouched,
  even if the caller passed `confirm: true`. Clients without elicitation
  support must pass `confirm: true` instead. Entries are addressed by id
  (`list_sources`, `list_studio_artifacts` now return ids) so identical
  titles can be told apart. Success is reported only after
  the server acknowledged the request *and* the entry disappeared (the UI
  removes sources optimistically even when the request fails). Verified in a
  dry run with all writes blocked: each flow reaches the delete request and
  nothing was removed.
- **Notes → sources**: `save_answer_as_note` (latest answer or by question,
  verified against the answer text) and `convert_note_to_source` (one note
  or all). `list_studio_artifacts` now lists notes too.

#### MCP protocol features

Each feature is optional for the client; clients without it behave as before.

- **Tasks** (experimental, spec 2025-11-25). `ask_question`, `add_source`,
  `generate_audio`, `generate_studio_artifact`, `download_audio`,
  `save_answer_as_note` and `convert_note_to_source` declare
  `execution.taskSupport: "optional"`. Called as a task, the tool runs in the
  background with status messages, and supports `tasks/get`, `tasks/result`,
  `tasks/cancel` and `tasks/list`. Studio tasks complete only when the new
  item is `ready` in the Studio library (or straight away when queued with
  "Generate later"). This replaces the generate → poll → fetch loop.
- **Cancellation.** `notifications/cancelled` (and `tasks/cancel`) stop the
  running browser work at the next wait step: answer polling, uploads, Studio
  and audio waits. The session stays usable.
- **Structured output.** `list_sources`, `list_studio_artifacts`,
  `get_usage` and `list_prompt_templates` declare an `outputSchema` and
  return `structuredContent`. Failed calls carry `isError: true`.
- **Elicitation**, in addition to the delete approval:
  - ambiguous source or Studio names open a chooser instead of failing;
  - `re_auth` and `cleanup_data(confirm: true)` ask the user before deleting
    local login and profile data;
  - `generate_studio_artifact(ask_options: true)` shows a form with the
    type's options, pre-filled with the given arguments.
- **Sampling.** `add_notebook` no longer requires `description` and
  `topics`. When they are omitted, the server reads the notebook's source
  titles and the client's model proposes them through sampling. Clients
  without sampling get metadata derived from the titles. The proposal is
  returned as `generated_metadata`.
- **Roots.** Local paths for `add_source(type: "file")` and `download_audio`
  are checked against the client's roots plus `NOTEBOOKLM_FILE_ROOTS`.
  `NOTEBOOKLM_REQUIRE_FILE_ROOTS=true` denies file access when no root is
  known. The check follows symlinks (realpath).
- **Logging.** Server logs are forwarded as `notifications/message`. The
  default minimum level is `warning`; the client can change it with
  `logging/setLevel`, and `NOTEBOOKLM_CLIENT_LOG_LEVEL` sets the default.
- **Resource subscriptions.**
  - Library notebooks expose live views `notebooklm://notebook/{uuid}/sources`
    and `/studio`.
  - `resources/subscribe` polls them (`NOTEBOOKLM_SUBSCRIPTION_POLL_MS`,
    default 60 s, minimum 15 s) and sends `notifications/resources/updated`
    on change.
  - Library changes send `notifications/resources/list_changed`.
  - `resources/list` is paginated.
- **Icons and metadata.** Server and tool icons (light and dark), plus server
  `title` and `websiteUrl`.

### Changed

- **Package and maintainer.** Published as `@arlinamid/notebooklm-mcp`
  (repository, homepage and issue tracker point to arlinamid/notebooklm-mcp;
  the original author is credited in `contributors` and LICENSE). The server
  version in `serverInfo` and the startup banner is now read from
  package.json instead of being hard-coded.
- `add_source`: `type` now accepts `url | youtube | text | file`; `content`
  is required for all but `file`, which takes `file_paths`.
- `list_studio_artifacts` returns an `id` per entry and lists notes
  (`type: "note"`); `delete_studio_artifact` accepts that id.
- `ask_question` answers keep `[N]` citation markers inline (previously
  they leaked as separate lines); `source_format` excerpts come from the new
  citation tooltip.
- Rate-limit messages, tool descriptions and server instructions describe
  metered AI usage (rolling window + weekly limit, see `get_usage`) instead
  of "50 queries/day".
- README: notices that this is an independently maintained fork, and that
  the project is unofficial, not affiliated with Google, and automates the
  web UI at the user's own risk. New `SECURITY.md` (private vulnerability
  reporting).
- Releases are published from GitHub Actions (`publish.yml`, on a `v*` tag)
  with npm trusted publishing (OIDC). No npm token is stored, and every
  version has a provenance attestation. CI also adds a GitHub release from
  the CHANGELOG.
- `@modelcontextprotocol/sdk` upgraded from 1.20 to 1.32. The invalid
  `resourceTemplates` capability was removed.
- `add_notebook`: `description` and `topics` are now optional (see Sampling).
- The package now ships the `prompts/` directory (bundled prompt packs and
  their license notices); new npm script `import:prompts`.
- README: new package name and install instructions, upgrade notes from
  upstream 2.0.0, corrected Windows profile path and citation fields, new
  sections for prompt templates and approvals.

### Fixed

- **New host.** NotebookLM moved from `notebooklm.google.com` to
  `notebook.google.com` (the old host 301-redirects, path preserved). Login
  detection only accepted the old host, so `setup_auth` / auto-login waited
  for the full timeout and failed. Both hosts are now accepted, and legacy
  notebook links are rewritten to the new host.
- **Announcement modal.** A new `accessibility-promo-dialog` opens on the
  notebook page and blocks every click. It is now dismissed automatically
  (`dismissPromoDialogs`) before chat, source and audio actions.
- **Add source.** The dialog selector `[role="dialog"]` also matched a
  hidden, always-mounted emoji picker; it is now scoped to
  `mat-dialog-container`. Source-type buttons moved to
  `.source-action-button` (link icon `link_2`), the Insert button is now
  `mdc-button--unelevated mat-primary`. If no source-type button matches, the
  call now fails instead of typing into the dialog's web-search box.
- **Answer extraction.** The new "Thoughts" reasoning block is excluded from
  answers (it could also be mistaken for a finished answer while streaming);
  citation markers are rendered inline as `[N]` instead of stray lines.
  Answers containing words like "loading" or "searching" were treated as
  loading placeholders forever and timed out.
- **Audio.** Studio library items of any type (reports, slide decks, …)
  counted as a finished Audio Overview, and `download_audio` could open the
  wrong tile's menu. Audio tiles are now identified by the `audio_spark`
  glyph; the Download menu item uses the `save_alt` glyph.
- **Audio generation did nothing.** Clicking a Studio tile now opens a
  customise dialog instead of generating; `generate_audio` reported
  `started` although nothing was queued. It now fills the dialog and clicks
  "Generate now" (the legacy one-click and "customise" flows remain as
  fallbacks).
- **Audio status.** The generating tile (`progress_activity` glyph, disabled
  button) is now detected, so `get_audio_status` reports `in_progress`
  instead of `not_started`, and a generating tile is no longer mistaken for a
  finished one.
- **Audio download.** "Download" now opens a popup that downloads from
  drum.usercontent.google.com, and headless Chrome then tore down the whole
  browser context. The popup's URL is captured and the file fetched with the
  context's own HTTP client (UTF-8 file names preserved); the legacy in-page
  `download` event is still accepted.
- **Citations.** A marker click now opens an inline tooltip
  (`.citation-tooltip-text`) instead of highlighting the source panel, so
  `source_format` only returned source names. The tooltip is read first; the
  legacy `.highlighted` path is kept as fallback.
- **Chat history race.** Right after a notebook loads, the chat history is
  not in the DOM yet and streams in. `ask_question` now waits for it to
  settle before snapshotting prior answers, so an old answer can't be
  mistaken for the new one.
- **List indexing.** Patchright's `locator.nth()` was observed to resolve
  NotebookLM list items out of DOM order; index-based clicks now go through a
  DOM-order helper (`domClickPath`).
- **Saving the wrong answer as a note.** Selecting a chat turn and clicking
  its "Save to note" button now happen in one DOM pass, and the saved note is
  checked against the answer text.
- **Prompts capability.** `prompts/list` / `prompts/get` were advertised but
  unhandled (see Added → MCP prompts).
- **HTTP transport with several clients**
  ([upstream #56](https://github.com/PleasePrompto/notebooklm-mcp/issues/56)).
  The second client got "Already connected to a transport", because one MCP
  `Server` instance can only serve one transport. Each Streamable-HTTP
  session now gets its own server. Browser sessions, the library and the
  task store stay shared; resource subscriptions and the log level are per
  session. The smoke test covers three concurrent HTTP sessions.
- **Non-Latin notebook names** got an empty library id and could not be
  selected, updated or removed
  ([upstream #89](https://github.com/PleasePrompto/notebooklm-mcp/issues/89)).
  Ids are now Unicode slugs with accents folded (`Lánchíd` → `lanchid`), and
  fall back to `notebook`. Existing ids are unchanged.
- **WSL2 / root on Linux**: Chrome exited immediately because its sandbox
  cannot start there
  ([upstream #105](https://github.com/PleasePrompto/notebooklm-mcp/issues/105)).
  `--no-sandbox` is now added automatically under WSL and for root.
  `NOTEBOOKLM_NO_SANDBOX=true|false` overrides the detection.
- **Loading placeholder ending in "…"** (U+2026) was returned as the answer
  on non-English UIs
  ([upstream #110](https://github.com/PleasePrompto/notebooklm-mcp/issues/110)).
- **Progress notifications** never fired: the progress token was read from
  the tool arguments instead of `params._meta.progressToken`. Both locations
  are now accepted, and notifications go to the requesting session.
- **Build on Windows.** `postbuild` used `chmod +x`, which fails under npm's
  default Windows shell (and so broke `npm publish` there); it now uses a
  Node one-liner.
- Chat submit button, query-input fallbacks and notebook-card selectors
  updated to the new markup.

### Security

- **Dropped `globby`.** Its dependency chain (fast-glob → micromatch →
  braces / picomatch) carried high-severity advisories:
  - GHSA-3v7f-55p6-f55p;
  - GHSA-c2c7-rcm5-vvqj;
  - braces stack exhaustion, which has no fixed release.

  `cleanup_data` now uses a small built-in matcher
  (`src/utils/simple-glob.ts`) that does not follow symlinks and limits
  recursion depth. It also works on Windows paths, where the old patterns
  never matched, and it finds the npx cache of the new package name too.
  `npm audit` reports 0 vulnerabilities (production and dev).

### Known limitations

- Google Drive and Google Play Books sources are not supported by
  `add_source`.
- Selectors were verified against the English UI (the server launches Chrome
  with `en-US`); text fallbacks for other locales are inherited from 2.0.0.
- `docs/` (tools, usage guide, configuration) still describe 2.0.0; the
  README and tool descriptions are current.

## [2.0.0] - 2026-04-30

Major release that closes the issue backlog and replaces the brittle parts of
the v1.x extraction stack with a single source of truth. v1 is no longer
supported.

### Added

- **Streamable-HTTP transport** (`--transport http --port 3000`) using the
  MCP SDK's `StreamableHTTPServerTransport`. Supports the spec's session
  header model so multiple clients can share one server. Closes #4 / #7.
- **`add_source` tool** for programmatic source ingestion (URL or pasted text,
  with auto-confirmed insertion and source-count verification). Closes #25.
- **Audio Overview tools**: `generate_audio` + `download_audio`. Audio is the
  most-asked Studio output; Video / Infographic / Slides are tracked for a
  follow-up. Closes #11 (audio scope).
- **Citations on `ask_question`**: new `source_format` argument (`none`,
  `inline`, `footnotes`, `json`) populates a structured `sources[]` field
  by reading the DOM citation panel after the answer settles. Closes #20.
- **Multi-account support** via `--account <name>` / `NOTEBOOKLM_ACCOUNT`.
  Each account gets an isolated Chrome profile under
  `~/.local/share/notebooklm-mcp/accounts/<name>/`. No credential storage —
  authentication is still handled by Chrome's persistent profile. Closes #2.
- **Bundled-Chromium fallback** (`BROWSER_CHANNEL=chromium` /
  `NOTEBOOKLM_BROWSER_CHANNEL=chromium`). Used automatically when system
  Chrome refuses to launch. Closes #13 (macOS Tahoe), #19 (Windows exit 21).
- **`ANSWER_TIMEOUT_MS`** env var + `browser_options.timeout_ms` parameter
  to override the answer wait. Default raised to 600 s. Closes #14, #27.
- **Provenance envelope** on `ask_question` results: `_provenance` field +
  AI-generated marker prefix (`NOTEBOOKLM_AI_MARKER=false` to opt out).
  Closes #42.

### Changed

- **Streaming-stability answer detection** replaces the broken
  `div.thinking-message` poll. Answers settle when the text is identical
  across N consecutive 750 ms polls. Robust against the 2026 NotebookLM UI
  changes that broke v1.x. Closes #43.
- **`FOLLOW_UP_REMINDER` is opt-in** via `NOTEBOOKLM_FOLLOW_UP_REMINDER=true`.
  The previous default tripped prompt-injection guards on safety-trained
  host agents. Closes #28.
- **Selector registry** (`src/notebooklm/selectors.ts`) is now the single
  source of truth for every CSS / aria selector targeting NotebookLM. UI
  changes from Google now require touching exactly one file.
- **Browser-launch lifecycle** moved into a dedicated module with profile
  strategy fallback (`auto` → isolated profile when the base profile is
  locked) and aggressive shutdown watchdog. Closes #29.
- **Watchdog poll loop**: bounded poll count + Node-side sleep fallback +
  periodic `page.evaluate(() => true)` health check. Defuses zombie tabs
  that previously turned the answer wait into a 100 % CPU spin. Closes #16.
- **Resource error message** for unknown URIs now lists the supported set
  (`notebooklm://library`, `notebooklm://library/{id}`, `notebooklm://metadata`).
  Closes #15.
- **Library metadata accessors** in `src/library/metadata.ts` defend against
  notebooks loaded from disk that omit `topics`/`use_cases`/`content_types`.
  Replaces the bare `.join()` / `.map()` calls that crashed
  `buildAskQuestionDescription`. Closes #33.

### Tooling

- ESLint flat config + Prettier added with `npm run lint`, `npm run format`,
  `npm run check`. Build is now type-safe with no `any` casts and DOM types
  enabled for in-page evaluations.
- TypeScript `lib` widened to `["ES2022", "DOM", "DOM.Iterable"]`.
- New tools registered in MCP profile: `add_source`, `generate_audio`,
  `download_audio` (full profile only by default).

### Removed

- Hard-coded `120 000 ms` answer timeout in `BrowserSession.ask`.
- Unused `ServerState` interface and the dead `as any` chain across
  resource handlers, browser session, shared-context manager, and the
  config env-override path.
- Reliance on `div.thinking-message` for answer completion.

### Migration Notes

- v1 callers that depended on the old answer prefix should set
  `NOTEBOOKLM_AI_MARKER=false` if they want the unprefixed answer back.
- v1 callers that depended on the appended follow-up reminder must opt in
  via `NOTEBOOKLM_FOLLOW_UP_REMINDER=true`.
- The default answer timeout grew from 120 s to 600 s. Lower it explicitly
  via `ANSWER_TIMEOUT_MS` if you relied on the 2-minute ceiling for
  fail-fast behaviour.

## [1.2.0] - 2025-11-21

### Added
- **Tool Profiles System** - Reduce token usage by loading only the tools you need
  - Three profiles: `minimal` (5 tools), `standard` (10 tools), `full` (16 tools)
  - Persistent configuration via `~/.config/notebooklm-mcp/settings.json`
  - Environment variable overrides: `NOTEBOOKLM_PROFILE`, `NOTEBOOKLM_DISABLED_TOOLS`

- **CLI Configuration Commands** - Easy profile management without editing files
  - `npx notebooklm-mcp config get` - Show current configuration
  - `npx notebooklm-mcp config set profile <name>` - Set profile (minimal/standard/full)
  - `npx notebooklm-mcp config set disabled-tools <list>` - Disable specific tools
  - `npx notebooklm-mcp config reset` - Reset to defaults

### Changed
- **Modularized Codebase** - Improved maintainability and code organization
  - Split monolithic `src/tools/index.ts` into `definitions.ts` and `handlers.ts`
  - Extracted resource handling into dedicated `ResourceHandlers` class
  - Cleaner separation of concerns throughout the codebase

### Fixed
- **LibreChat Compatibility** - Fixed "Server does not support completions" error
  - Added `prompts: {}` and `logging: {}` to server capabilities
  - Resolves GitHub Issue #3 for LibreChat integration

- **Thinking Message Detection** - Fixed incomplete answers showing placeholder text
  - Now waits for `div.thinking-message` element to disappear before reading answer
  - Removed unreliable text-based placeholder detection (`PLACEHOLDER_SNIPPETS`)
  - Answers like "Reviewing the content..." or "Looking for answers..." no longer returned prematurely
  - Works reliably across all languages and NotebookLM UI changes

## [1.1.2] - 2025-10-19

### Changed
- **README Documentation** - Added Claude Code Skill reference
  - New badge linking to [notebooklm-skill](https://github.com/PleasePrompto/notebooklm-skill) repository
  - Added prominent callout section explaining Claude Code Skill availability
  - Clarified differences between MCP server and Skill implementations
  - Added navigation link to Skill repository in top menu
  - Both implementations use the same browser automation technology

## [1.1.1] - 2025-10-18

### Fixed
- **Binary executable permissions** - Fixed "Permission denied" error when running via npx
  - Added `postbuild` script that automatically runs `chmod +x dist/index.js`
  - Ensures binary has executable permissions after compilation
  - Fixes installation issue where users couldn't run the MCP server

### Repository
- **Added package-lock.json** - Committed lockfile to repository for reproducible builds
  - Ensures consistent dependency versions across all environments
  - Improves contributor experience with identical development setup
  - Enables `npm ci` for faster, reliable installations in CI/CD
  - Follows npm best practices for library development (2025)

## [1.1.0] - 2025-10-18

### Added
- **Deep Cleanup Tool** - Comprehensive system cleanup for fresh NotebookLM MCP installations
  - Scans entire system for ALL NotebookLM files (installation data, caches, logs, temp files)
  - Finds hidden files in NPM cache, Claude CLI logs, editor logs, system trash, temp backups
  - Shows categorized preview before deletion with exact file list and sizes
  - Safe by design: Always requires explicit confirmation after preview
  - Cross-platform support: Linux, Windows, macOS
  - Enhanced legacy path detection for old config.json files
  - New dependency: globby@^14.0.0 for advanced file pattern matching
- CHANGELOG.md for version tracking
- Changelog badge and link in README.md

### Changed
- **Configuration System Simplified** - No config files needed anymore!
  - `config.json` completely removed - works out of the box with sensible defaults
  - Settings passed as tool parameters (`browser_options`) or environment variables
  - Claude can now control ALL browser settings via tool parameters
  - `saveUserConfig()` and `loadUserConfig()` functions removed
- **Unified Data Paths** - Consolidated from `notebooklm-mcp-nodejs` to `notebooklm-mcp`
  - Linux: `~/.local/share/notebooklm-mcp/` (was: `notebooklm-mcp-nodejs`)
  - macOS: `~/Library/Application Support/notebooklm-mcp/`
  - Windows: `%LOCALAPPDATA%\notebooklm-mcp\`
  - Old paths automatically detected by cleanup tool
- **Advanced Browser Options** - New `browser_options` parameter for browser-based tools
  - Control visibility, typing speed, stealth mode, timeouts, viewport size
  - Stealth settings: Random delays, human typing, mouse movements
  - Typing speed: Configurable WPM range (default: 160-240 WPM)
  - Delays: Configurable min/max delays (default: 100-400ms)
  - Viewport: Configurable size (default: 1024x768, changed from 1920x1080)
  - All settings optional with sensible defaults
- **Default Viewport Size** - Changed from 1920x1080 to 1024x768
  - More reasonable default for most use cases
  - Can be overridden via `browser_options.viewport` parameter
- Config directory (`~/.config/notebooklm-mcp/`) no longer created (not needed)
- Improved logging for sessionStorage (NotebookLM does not use sessionStorage)
- README.md updated to reflect config-less architecture

### Fixed
- **Critical: envPaths() default suffix bug** - `env-paths` library appends `-nodejs` suffix by default
  - All paths were incorrectly created with `-nodejs` suffix
  - Fix: Explicitly pass `{suffix: ""}` to disable default behavior
  - Affects: `config.ts` and `cleanup-manager.ts`
  - Result: Correct paths now used (`notebooklm-mcp` instead of `notebooklm-mcp-nodejs`)
- Enhanced cleanup tool to detect all legacy paths including manual installations
  - Added `getManualLegacyPaths()` method for comprehensive legacy file detection
  - Finds old config.json files across all platforms
  - Cross-platform legacy path detection (Linux XDG dirs, macOS Library, Windows AppData)
- **Library Preservation Option** - cleanup_data can now preserve library.json
  - New parameter: `preserve_library` (default: false)
  - When true: Deletes everything (browser data, caches, logs) EXCEPT library.json
  - Perfect for clean reinstalls without losing notebook configurations
- **Improved Auth Troubleshooting** - Better guidance for authentication issues
  - New `AuthenticationError` class with cleanup suggestions
  - Tool descriptions updated with troubleshooting workflows
  - `get_health` now returns `troubleshooting_tip` when not authenticated
  - Clear workflow: Close Chrome → cleanup_data(preserve_library=true) → setup_auth/re_auth
  - Critical warnings about closing Chrome instances before cleanup
- **Critical: Browser visibility (show_browser) not working** - Fixed headless mode switching
  - **Root cause**: `overrideHeadless` parameter was not passed from `handleAskQuestion` to `SessionManager`
  - **Impact**: `show_browser=true` and `browser_options.show=true` were ignored, browser stayed headless
  - **Solution**:
    - `handleAskQuestion` now calculates and passes `overrideHeadless` parameter correctly
    - `SharedContextManager.getOrCreateContext()` checks for headless mode changes before reusing context
    - `needsHeadlessModeChange()` now checks CONFIG.headless when no override parameter provided
  - **Session behavior**: When browser mode changes (headless ↔ visible):
    - Existing session is automatically closed and recreated with same session ID
    - Browser context is recreated with new visibility mode
    - Chat history is reset (message_count returns to 0)
    - This is necessary because NotebookLM chat state is not persistent across browser restarts
  - **Files changed**: `src/tools/index.ts`, `src/session/shared-context-manager.ts`

### Removed
- Empty postinstall scripts (cleaner codebase)
  - Deleted: `src/postinstall.ts`, `dist/postinstall.js`, type definitions
  - Removed: `postinstall` npm script from package.json
  - Follows DRY & KISS principles

## [1.0.5] - 2025-10-17

### Changed
- Documentation improvements
- Updated README installation instructions

## [1.0.4] - 2025-10-17

### Changed
- Enhanced usage examples in documentation
- Fixed formatting in usage guide

## [1.0.3] - 2025-10-16

### Changed
- Improved troubleshooting guide
- Added common issues and solutions

## [1.0.2] - 2025-10-16

### Fixed
- Fixed typos in documentation
- Clarified authentication flow

## [1.0.1] - 2025-10-16

### Changed
- Enhanced README with better examples
- Added more detailed setup instructions

## [1.0.0] - 2025-10-16

### Added
- Initial release
- NotebookLM integration via Model Context Protocol (MCP)
- Session-based conversations with Gemini 2.5
- Source-grounded answers from notebook documents
- Notebook library management system
- Google authentication with persistent browser sessions
- 16 MCP tools for comprehensive NotebookLM interaction
- Support for Claude Code, Codex, Cursor, and other MCP clients
- TypeScript implementation with full type safety
- Playwright browser automation with stealth mode