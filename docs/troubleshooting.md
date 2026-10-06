# Troubleshooting

A symptom → fix matrix for v3.2. Many operations use NotebookLM's data API and fall back to the web UI; the server log says `RPC path failed — using the UI instead` when that happens. For the full env-var inventory, see [`configuration.md`](./configuration.md).

## Where are the logs?

The server writes every log line to `<data dir>/logs/server.log` (Windows: `%LOCALAPPDATA%\notebooklm-mcp\Data\logs\server.log`; set `NOTEBOOKLM_LOG_FILE` to move or disable it). Each line carries the process id: with several clients only the leader instance (`<data dir>/leader.json`) drives the browser, so its lines hold the details — e.g. why an RPC call fell back to the web UI.

Client-side logs show only what the client saw. Claude Code (and the Claude desktop Code tab) keeps them per project under `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<project>\mcp-logs-notebooklm\` — tool calls, durations and errors such as a 60 s `Request timed out`, but not the server's own output.

## Chrome fails to launch (macOS Tahoe / Windows exit 21)

Symptom: `Failed to launch chrome`, `chrome exited immediately`, `code 21`, `executable doesn't exist`.

Cause: System Chrome on macOS 26 (Tahoe) and certain Windows 11 setups crashes on the persistent profile launch.

Fix: Force the bundled Patchright Chromium.

```bash
BROWSER_CHANNEL=chromium npx @arlinamid/notebooklm-mcp@latest
# or
NOTEBOOKLM_BROWSER_CHANNEL=chromium npx @arlinamid/notebooklm-mcp@latest
```

The fallback is also auto-applied when launch errors match the known patterns, but setting the env var explicitly makes the choice deterministic.

## `ask_question` times out

Symptom: The tool fails after roughly 10 min with a timeout error.

Checks:

1. Confirm the answer wait is sufficient — long-form prompts on notebooks with many sources legitimately exceed 2 min.
   ```bash
   ANSWER_TIMEOUT_MS=900000 npx @arlinamid/notebooklm-mcp@latest   # 15 minutes
   ```
   Or per-call: `browser_options.timeout_ms`.
2. Run with a visible browser to see what NotebookLM is doing:
   ```json
   { "name": "ask_question", "arguments": { "question": "...", "show_browser": true } }
   ```
   Or start the server with `HEADLESS=false`.
3. Check `get_health` — if `authenticated=false`, the page is on the login screen, not the notebook.

## Session expired / repeated login prompts

Symptom: NotebookLM keeps redirecting to the login screen, or `get_health` reports `authenticated=false` after a previously successful login.

Workflow:

1. Close every Chrome / Chromium instance the user has open. An open Chrome can hold the persistent profile lock.
2. `re_auth` to wipe stored auth and prompt for a fresh login.
3. If `re_auth` fails repeatedly, run `cleanup_data` with the library preserved:
   ```json
   { "name": "cleanup_data", "arguments": { "confirm": false, "preserve_library": true } }
   ```
   Review the preview, then run again with `confirm: true`. Then `setup_auth`.

## WSL1

Symptom: Chrome refuses to launch under WSL1.

Fix: Upgrade to WSL2.

```powershell
wsl --set-default-version 2
wsl --set-version <distro> 2
```

WSL2 with WSLg (Windows 11 / Windows 10 22H2+) supports a real Chromium and works out of the box.

## Headless Linux server

Symptom: `setup_auth` fails on a server with no display because the login window cannot open.

Fix: Run the one-time setup under `xvfb-run`. After login the persistent Chrome profile lets every subsequent run go fully headless.

```bash
xvfb-run -a npx @arlinamid/notebooklm-mcp@latest
# call setup_auth from your client, complete login, then exit
# from then on, run normally:
npx @arlinamid/notebooklm-mcp@latest
```

## "Unknown resource: mcp://notebooklm"

Cause: A client used the wrong URI scheme.

Fix: The scheme is `notebooklm://`, not `mcp://`. Supported URIs:

- `notebooklm://library`
- `notebooklm://library/{id}`
- `notebooklm://metadata` (deprecated)

The error message in v2 lists the correct set.

## Orphan Chrome processes

Symptom: Chrome processes survive after the MCP server exits.

v2 ships a 5-second shutdown watchdog and an aggressive teardown path, so this is rare. If it does happen:

1. Kill the lingering Chromes manually.
2. Run `cleanup_data` with `preserve_library: true` to remove stale profile locks.
3. Restart the server.

## Profile lock / `ProcessSingleton` errors

Cause: Another Chrome owns the base profile.

Several server instances on the same data directory (e.g. Claude Desktop's chat and Code tab) no longer compete for it: the first one is the leader and owns the browser, the others forward to it (see [Several clients on one account](#several-clients-on-one-account)). If you still see this error, another program — or an older server version — holds the profile.

Fallback: the default `NOTEBOOK_PROFILE_STRATEGY=auto` switches to an isolated per-instance profile seeded with the saved cookies. Avoid relying on it: the same Google session then runs in two browsers, which Google may answer by asking to sign in again. To force isolation always:

```bash
NOTEBOOK_PROFILE_STRATEGY=isolated npx @arlinamid/notebooklm-mcp@latest
```

## Usage limit reached

Symptom: `NotebookLM usage limit reached (rolling window resets every few hours; there is also a weekly limit …)`.

NotebookLM meters AI usage in two windows instead of a daily question count. `get_usage` shows both percentages and when they reset. Studio generations (audio, video, slides) use far more than questions.

Options:

- Use `re_auth` to switch to a different Google account.
- Use multi-account mode for a clean separation:
  ```bash
  NOTEBOOKLM_ACCOUNT=backup npx @arlinamid/notebooklm-mcp@latest
  ```
- Wait until the window resets (`get_usage`), or queue Studio work with `generate_later: true`.
- Upgrade to Google AI Pro/Ultra for higher limits.

## Stealth typing too slow

Questions are sent through NotebookLM's query endpoint, so typing only happens on the UI fallback (or with `NOTEBOOKLM_USE_RPC=false`). There, the default `160–240 WPM` range is realistic but slow for batch use. Either disable stealth typing or tighten the range:

```bash
STEALTH_HUMAN_TYPING=false npx @arlinamid/notebooklm-mcp@latest
# or
TYPING_WPM_MIN=400 TYPING_WPM_MAX=600 npx @arlinamid/notebooklm-mcp@latest
```

## Citations are empty for `source_format=footnotes`

Citations come with the answer from NotebookLM's query endpoint (on the UI fallback, from the page's citation panel). If there are none:

- The notebook may not have grounded sources for that question.
- The UI may have shifted — check the active selectors in `src/notebooklm/selectors.ts`.
- Run with `show_browser=true` and inspect the live page after the answer renders.

## Follow-up reminder is missing

In v2 the follow-up reminder appended to `ask_question` answers is off by default. Re-enable with:

```bash
NOTEBOOKLM_FOLLOW_UP_REMINDER=true npx @arlinamid/notebooklm-mcp@latest
```

## AI marker breaks downstream parsing

The default answer text starts with `[AI-GENERATED via Gemini 2.5 (NotebookLM) — …]`. To return to the unprefixed answer, set:

```bash
NOTEBOOKLM_AI_MARKER=false npx @arlinamid/notebooklm-mcp@latest
```

Or replace the prefix with your own:

```bash
NOTEBOOKLM_AI_MARKER_PREFIX="[notebooklm]" npx @arlinamid/notebooklm-mcp@latest
```

The `_provenance` envelope on the result remains regardless.

## HTTP transport: `unknown session`

Cause: The client made a `GET /mcp` or `POST /mcp` (non-initialize) without echoing the `Mcp-Session-Id` returned by the initial `initialize` response.

Fix: Capture the `Mcp-Session-Id` response header from the initialize call and pass it on every subsequent request. The lifecycle is owned by the MCP SDK's `StreamableHTTPServerTransport`.

## Answers or Studio outputs in the wrong language

Symptom: answers or generated audio / slides / infographics come out in English (or another unexpected language).

- Check the account's output language: `configure_output_language` without arguments. With **Default**, NotebookLM uses its interface language, and this server runs NotebookLM in English — so output is English. Set the user's language (ask them first; it is an account setting, also in the web app):
  ```json
  { "name": "configure_output_language", "arguments": { "language": "ja" } }
  ```
- For one Studio output, pass `language` to `generate_studio_artifact`. It takes a code (`ja`), the listed name (`日本語`) or the English name (`Japanese`).
- Slide-deck **titles** can come out in English even when the slides are in the requested language — NotebookLM behaviour, not fixable from here.

## Google asks to sign in again

Symptom: `Google asks to sign in again (the NotebookLM page redirected to accounts.google.com)`, or `get_health` says `authenticated: true` but notebook calls fail.

The saved cookies look valid, but Google wants the sign-in confirmed. Run `setup_auth` and sign in in the window it opens. A frequent trigger is the same Google session used from two browsers at once (e.g. an isolated profile fallback, or copying the Chrome profile) — keep one server version on all clients so they share one browser.

## "NotebookLM did not answer"

Symptom: `NotebookLM did not answer ("I’m having trouble responding right now.")`.

That is NotebookLM's own failure reply. Usually temporary — retry after a minute. If it persists, check the sign-in (`setup_auth`) and `get_usage`.

## Something broke after a NotebookLM update

Symptom: a tool fails with `RPC … failed` / `no result for … (RPC id rotated?)`, or answers / Studio calls behave oddly after Google changed NotebookLM.

Operations that have a UI path fall back to it automatically. To force the web UI everywhere until a fix is released:

```bash
NOTEBOOKLM_USE_RPC=false npx @arlinamid/notebooklm-mcp@latest
```

`download_studio_artifact` and `configure_output_language` exist only on the data API.

## Several clients on one account

Every MCP client (Claude Desktop's chat, its Code tab, Cursor, …) starts its own server process. On the same data directory the first one becomes the leader (`<dataDir>/leader.json`) and owns Chrome and the library; the others forward tool calls to it, and approvals / file roots / progress reach the right client. If the leader exits, the next call elects a new one.

- All instances must run a version with this feature (3.2+); an older one opens its own browser.
- `NOTEBOOKLM_SINGLE_BROWSER=false` turns it off (each instance on its own).
- A stale `leader.json` from a killed process is detected and replaced automatically.

## Research query refused, or research found nothing

`research_sources` refuses web queries under 4 words (Drive: 2) because every run spends AI usage and vague queries return loosely related pages. Name the subject, the aspect, the kind of source and the timeframe. A run that ends `failed` found nothing — rephrase with different terms (for Drive: words from the files' titles or content) rather than repeating the query; an identical query is answered from the notebook's research history without a new run.

## A report ignores the sources I chose

Pass `sources` with a document template (`briefing_doc`, `study_guide`, `blog_post`, `create_your_own`). The interactive `learning_overview` and the web app's Reports dialog use the sources checked in the notebook. Reports from a subset need NotebookLM's data API, so they are not available with `NOTEBOOKLM_USE_RPC=false`.

## NotebookLM tools are listed twice

The server is configured twice — by hand in the client's MCP settings and again by the plugin or Gemini extension (which start `npx -y @arlinamid/notebooklm-mcp@latest` themselves). Remove one of them; to keep a hand-made configuration, install only the skill (`npx @arlinamid/notebooklm-mcp skill install`).

## The agent does not use the skill

- `npx @arlinamid/notebooklm-mcp skill install --dry-run` shows where it would install. It installs only for agents it finds (their home folders); name others with `--agent`.
- Restart the agent after installing — skills are read at start-up.
- Claude Desktop / claude.ai: upload the ZIP from `skill zip` under Settings → Capabilities, with code execution turned on.
- The skill needs the MCP server connected; it does nothing without the tools.
