# `add_source` fails on a freshly created, empty notebook

- **Date:** 2026-10-06
- **Versions:** 3.2.0 (first two attempts), 3.3.0 (third attempt), both from `npx -y @arlinamid/notebooklm-mcp@latest`
- **Client:** Claude desktop app (Code tab), Windows 11
- **Auth:** `get_health` → `authenticated: true` (right after `setup_auth`)

## Summary

On a NotebookLM notebook created by hand in the web UI with **0 sources**, then
brought in with `import_account_notebooks`, `add_source` (`type: "url"`) never
adds a source. On 3.2.0 the call fails with the UI-fallback error. On 3.3.0 the
MCP request times out. `list_sources` shows the notebook stays empty both times.

## Steps to reproduce

1. Create a new, empty notebook at notebooklm.google.com. Leave it with no sources.
2. `import_account_notebooks` with `notebook_ids: ["<uuid>"]` → imported as
   `erotikus-ponyva-regenyek` (uuid `5d6833f9-392c-404e-a585-b83d35b9a5b7`).
3. `select_notebook` with that id.
4. `add_source` with `type: "url"` and `notebook_id: "erotikus-ponyva-regenyek"`.

## Observed

| # | Version | `content` | Result |
|---|---------|-----------|--------|
| 1 | 3.2.0 | 15 URLs, newline-separated | `success: false`, `sourceCountBefore: 0`, `sourceCountAfter: 0`, message: *"Could not find an input field inside the Add-source overlay. NotebookLM UI may have changed — please file an issue."* |
| 2 | 3.2.0 | 1 URL (`https://selfpublishingadvice.org/erotica-authors/`) | Same error as #1 |
| 3 | 3.3.0 | Same single URL | MCP error: `Request timed out` (client-side) |

After #3, `list_sources` → `{"sources": [], "count": 0}`. Nothing was added in the background.

Other tools worked in the same session: `get_health`, `setup_auth`,
`list_notebooks`, `import_account_notebooks` (dry run and real), `select_notebook`,
`list_sources`.

## Where the error comes from

`addSource()` in `src/session/browser-session.ts:782` tries the RPC path first
(`tryRpc("add_source", () => addSourcesRpc(...))`). If that returns `null`, it
falls back to the UI path `addSourceToPage()` in `src/notebooklm/sources.ts`.

- `tryRpc` returns `null` when `rpcEnabled()` is false, or when an `RpcError`
  other than code 16 is thrown. The reason is only written to the server log
  (`log.warning(... RPC path failed ...)`), and the tool result does not include it.
- The error message in #1 and #2 is thrown by `fillSourceContent()`
  (`src/notebooklm/sources.ts:374-379`). This means **both** paths failed:
  the RPC path returned `null`, then the UI path opened *some*
  `mat-dialog-container[role="dialog"]` but found no visible
  `textarea` or `input[type="text"]` inside it.
- `pickSourceType()` did **not** throw "Could not find the "url" source-type
  button". So one of two things happened: a `sourceTypeUrl` selector matched and
  was clicked, or no `.source-action-button` / `.drop-zone-icon-button` picker
  was visible at all.

The server log for these calls was not available. The Claude desktop logs under
`%APPDATA%\Claude\logs\mcp-server-notebooklm*.log` stop in April/August and do
not contain this session. So the RPC failure reason is unknown.

## Root cause (confirmed live, 2026-10-06)

1. **RPC path:** on a notebook with 0 sources, `rLM1Ne` returns
   `[["<title>", null, "<uuid>", …]]`. The source list slot is `null`, not
   `[]`. `listRawSources` (and `listSourceDetailsRpc`) threw
   `RpcError("unexpected notebook response")` for that, and `tryRpc` silently
   fell back to the UI. Calling `izAoDd` directly on an empty notebook works fine.
2. **UI fallback:** an empty notebook auto-opens Add-source (`?addSource=true`)
   on top of `<accessibility-promo-dialog>` ("We're giving you more
   flexibility…"). The Add-source modal covers the promo's close button, so
   `dismissPromoDialogs` could not close it. The promo stayed the first
   `mat-dialog-container[role="dialog"]`, and `overlayPane` matched the promo
   (no inputs) instead of `<add-sources-dialog>`.
3. **Timeout on 3.3.0:** the Claude Code client gives up after 60 s
   (`Tool 'add_source' failed after 60s: Error: Request timed out` in
   `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<project>\mcp-logs-notebooklm\`).
   The follower→leader forward allows 1 h, so the 60 s limit is on the client
   side. The RPC path waited up to 90 s for processing and sent no progress.
4. **No server log:** the server only logged to stderr. The client log keeps
   only client-side events, and the work runs in the leader instance, whose
   stderr belongs to whichever client started it.

## Resolution (unreleased)

- `notebookSourceList()` treats a `null` source list as empty (RPC add and
  `list_sources`).
- Promo dialogs that cannot be closed stay marked (`data-mcp-promo-dialog`) and
  are excluded from `overlayPane`/`overlayInput`/`overlayTextarea`. The close
  falls back to `dispatchEvent("click")`, and promos are swept again in
  `openAddSourceOverlay`.
- The `add_source` message includes the RPC error when both paths fail.
- The RPC processing wait dropped to 40 s and sends progress; sources still
  processing come back as `pending`.
- File log: `<data dir>/logs/server.log` (`NOTEBOOKLM_LOG_FILE`).
- New tools: `create_notebook` (`CCqFvf`), `rename_notebook` (`s0tc2d`),
  `delete_notebook` (`WWINqb`, with approval or `confirm: true`, verified
  against the account list).

Verified end to end over MCP stdio on throwaway notebooks (created, filled
and deleted by the test): RPC path `add_source` 16–19 s, 0 → 1 source; UI path
(`NOTEBOOKLM_USE_RPC=false`) 5.7 s, 0 → 1 source. Smoke test passes (41 tools).

## Still open

- **Leader/follower version mismatch:** a newer follower forwards calls to an
  older leader, which answers `Unknown tool: create_notebook`. Seen during
  testing with leader 3.3.0 (pid in `leader.json`). Until every instance runs
  the new version, restart all clients, or the follower should handle tools
  the leader does not list.
- Claude Code truncates the server instructions (5643 → 2048 chars) and the
  `ask_question` description (3435 → 2048) — see the client log.

## Hypotheses (initial, before the live check)

1. **Different first-source dialog on empty notebooks.** A notebook with 0
   sources auto-opens the Add-source modal (see the comment on
   `openAddSourceOverlay`). That modal may differ from the one the sidebar
   button opens. For example, the URL field may be a `type="url"` input, a
   `contenteditable`, or a chip input, which `overlayInput` / `overlayTextarea`
   would not match. Or the dialog matched by `overlayPane` may be a different
   modal (welcome or onboarding) rather than the Add-source modal.
2. **RPC path fails on an empty notebook.** `addSourcesRpc` calls
   `listRawSources` first. If that or `RPC_ADD_SOURCE` returns an unexpected
   shape for a notebook with no sources, `tryRpc` silently drops to the UI path,
   which then hits hypothesis 1.
3. **Timeout on 3.3.0.** `addSourcesRpc` waits up to `waitMs = 90_000` for
   processing, then `reloadPage()` runs. If the RPC path fails, the UI path can
   take another ~90 s+. Either path can exceed the MCP client's request timeout,
   so the client cancels before the tool returns its result. 3.3.0 may also have
   failed in the same way as 3.2.0, with the result never reaching the client.
4. **UI locale.** The account may use a non-English (Hungarian) UI. The
   icon-anchored selectors should not depend on language, but every text
   fallback in `selectors.ts` (`sourceTypeUrl`, `addButton`, `insertConfirm`)
   covers only EN/DE/FR/ES/IT/PT/NL/JA, with no `hu` entries. If Google changes
   an icon name, the Hungarian UI has no fallback.

## Suggested next steps

- Run `add_source` with `show_browser: true` against an empty notebook and record
  which dialog is open when `fillSourceContent` runs. Dump
  `mat-dialog-container[role="dialog"]` `outerHTML` on failure.
- Include the RPC failure reason in the tool result (for example a
  `rpcError` field or an addition to `message`), not only in the server log, so
  this can be diagnosed from the client side.
- Report progress (`reportProgress`) during the 90 s processing wait, or return
  early with `pending` status, so long URL imports don't hit client timeouts.
- Check whether `addSourcesRpc` works on a notebook with 0 sources
  (`listRawSources` result shape).
- Consider adding `hu` text fallbacks to the source-type and confirm selectors.

## Workaround

Add the first source by hand in the web UI, then retry `add_source`. It has not
yet been confirmed that the tool works once the notebook is no longer empty.
