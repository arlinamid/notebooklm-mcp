/**
 * NotebookLM source ingestion (issue #25).
 *
 * Supported source types:
 *   - `url` / `youtube` — website or YouTube URL(s), crawled by NotebookLM
 *   - `text` — pasted raw text (treated as a copied document)
 *   - `file` — local files via the dialog's native file chooser
 *
 * Google Drive and Play Books imports are not supported (they open Google's
 * own pickers).
 *
 * Robustness strategy (2026-05, ported from the Fork's content-manager.ts):
 *
 *   1. Capture the *expected notebook UUID* from the URL up-front. NotebookLM
 *      sometimes redirects pasted-text uploads to a freshly-created notebook;
 *      we detect that and surface a clear error.
 *
 *   2. Resolve the dialog state defensively: if a dialog is already open we
 *      use it; otherwise we click the sidebar "Add source" button. The
 *      `[role="dialog"]` anchor is set synchronously on mount, so we do not
 *      have to race the Material `.mdc-dialog--open` animation class.
 *
 *   3. Source-type buttons no longer ship with aria-labels — see
 *      selectors.ts for the icon-/text-based anchors.
 *
 *   4. Insert verification is COUNT-BASED: snapshot
 *      `.single-source-container` count before the submit click, then poll
 *      after the dialog closes (up to 90 s — URL crawls are slow).
 */

import type { Page } from "patchright";
import path from "path";
import fs from "fs/promises";
import { Selectors, joinAlt } from "./selectors.js";
import { dismissPromoDialogs } from "./dialogs.js";
import { reportProgress } from "../utils/request-context.js";
import { safeSleep, isRecoverable } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

/**
 * `youtube` uses the same "Website and YouTube URLs" field as `url`; several
 * URLs may be given separated by spaces or new lines. `file` uploads local
 * files through the dialog's native file chooser (pdf, text, markdown, docs,
 * audio, images …) — added 2026-10.
 */
export type SourceType = "url" | "text" | "youtube" | "file";

export interface AddSourceInput {
  type: SourceType;
  /** URL(s) for `url` / `youtube`, raw text for `text`; unused for `file`. */
  content: string;
  /** Optional title shown in the source list. NotebookLM uses a default if omitted. */
  title?: string;
  /** Absolute local paths for `type: "file"`. */
  filePaths?: string[];
}

export interface AddSourceResult {
  success: boolean;
  type: SourceType;
  sourceCountBefore: number;
  sourceCountAfter: number;
  message?: string;
  /** Ids of the added sources (RPC path; usable in `sources` arguments). */
  sourceIds?: string[];
}

export async function addSource(page: Page, input: AddSourceInput): Promise<AddSourceResult> {
  const initialUrl = page.url();
  const expectedUuid = initialUrl.match(/notebook\/([a-f0-9-]+)/)?.[1];
  log.info(`📄 [add_source] type=${input.type} target_uuid=${expectedUuid ?? "?"}`);
  if (input.type !== "file" && !input.content.trim()) {
    return {
      success: false,
      type: input.type,
      sourceCountBefore: 0,
      sourceCountAfter: 0,
      message: `\`content\` is required for type "${input.type}".`,
    };
  }

  try {
    // 0. Announcement modals block clicks and look like the Add-source dialog.
    await dismissPromoDialogs(page);

    // 1. Open the Add-source dialog (or use one that's already open).
    await openAddSourceOverlay(page);

    if (input.type === "file") {
      return await uploadFiles(page, input.filePaths ?? []);
    }

    // 2. Pick the source type if there is a picker. Some overlay variants
    //    drop straight into an input field; pickSourceType is a no-op then.
    await pickSourceType(page, input.type);

    // 3. Fill the content + optional title.
    await fillSourceContent(page, input);

    // 4. Snapshot the source count *before* submitting. The Fork captures it
    //    here (dialog still open, sidebar list not yet updated) so the
    //    post-close poll can detect a real increment.
    const before = await countSources(page);
    log.info(`  📊 source count before submit: ${before}`);

    // 5. Click the primary "Insert" / "Hinzufügen" button.
    await confirmInsert(page);

    // 6. Wait for the dialog to animate away. NotebookLM doesn't append the
    //    new sidebar entry until the modal is fully gone.
    await waitForOverlayToClose(page);

    // 7. UUID redirect check: pasted-text uploads occasionally land in a new
    //    "Untitled notebook" instead of the target. Catch that here so the
    //    caller sees a useful error instead of a phantom success.
    if (expectedUuid) {
      const currentUrl = page.url();
      const currentUuid = currentUrl.match(/notebook\/([a-f0-9-]+)/)?.[1];
      if (currentUuid && currentUuid !== expectedUuid) {
        log.error(`  ❌ Notebook redirect: expected ${expectedUuid}, got ${currentUuid}`);
        return {
          success: false,
          type: input.type,
          sourceCountBefore: before,
          sourceCountAfter: before,
          message:
            `NotebookLM redirected to a different notebook (${currentUuid}) instead of ` +
            `the target (${expectedUuid}). This is a known quirk for pasted-text uploads — ` +
            `the source landed in a new "Untitled notebook".`,
        };
      }
    }

    // 8. Poll the source count for up to 90 s; URL crawls and large pastes
    //    can take a while to materialise as a sidebar entry.
    const after = await waitForSourceCountIncrease(page, before, 90_000);

    if (after > before) {
      log.success(`  ✅ source added (count ${before} → ${after})`);
      return {
        success: true,
        type: input.type,
        sourceCountBefore: before,
        sourceCountAfter: after,
      };
    }

    // 9. Last-ditch: maybe an error toast surfaced; surface it verbatim.
    const errorText = await readDialogError(page);
    return {
      success: false,
      type: input.type,
      sourceCountBefore: before,
      sourceCountAfter: after,
      message:
        errorText ||
        "Source dialog completed but the source list did not grow within 90 s. " +
          "Either NotebookLM is still crawling/indexing or the upload silently failed.",
    };
  } catch (err) {
    if (isRecoverable(err)) throw err;
    log.warning(`  ⚠️  add_source failed: ${err}`);
    return {
      success: false,
      type: input.type,
      sourceCountBefore: 0,
      sourceCountAfter: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Count sources in the sidebar via two independent anchors:
 *
 *   1. `.single-source-container` — the per-row sidebar element. Most
 *      direct, but only present once the sidebar has hydrated.
 *
 *   2. `.cover-subtitle-source-count` — a header label of the form
 *      `"3 Quellen"` / `"3 sources"`. Robust to a collapsed or partially
 *      hydrated sidebar because it lives in the chat header instead.
 *
 * We return whichever produces a higher count; mismatches between the two
 * usually mean the sidebar hasn't caught up yet, in which case the header
 * is the authoritative ground truth.
 */
export async function countSources(page: Page): Promise<number> {
  let containerCount = 0;
  try {
    containerCount = await page.locator(Selectors.sources.sourceContainer).count();
  } catch {
    /* fall through */
  }

  let headerCount = 0;
  try {
    const headerText = await page
      .locator(".cover-subtitle-source-count")
      .first()
      .textContent({ timeout: 500 })
      .catch(() => null);
    const match = headerText?.match(/(\d+)/);
    if (match) headerCount = parseInt(match[1], 10);
  } catch {
    /* ignore */
  }

  return Math.max(containerCount, headerCount);
}

/**
 * Open the Add-source modal. Order of attempts:
 *   1. Dialog already open → use it (auto-modal on fresh notebooks).
 *   2. Click the sidebar "Add source" button.
 *   3. Last resort: navigate to `?addSource=true`, which auto-opens.
 */
async function openAddSourceOverlay(page: Page): Promise<void> {
  // A promo can mount after the first sweep (it animates in late on a fresh
  // notebook); marking it keeps `overlayPane` from matching it.
  await dismissPromoDialogs(page);
  if (await isOverlayVisible(page)) {
    log.info("  ✅ Add-source dialog already open, reusing");
    return;
  }

  // Try the sidebar button first — fastest path on a populated notebook.
  try {
    await page.locator(joinAlt(Selectors.sources.addButton)).first().click({ timeout: 5_000 });
    await page
      .locator(Selectors.sources.overlayPane)
      .first()
      .waitFor({ state: "visible", timeout: 8_000 });
    return;
  } catch (err) {
    log.warning(
      `  ⚠️  Add-source button click failed (${err}), trying ?addSource=true URL fallback`
    );
  }

  // URL fallback — useful when the sidebar button is hidden or covered.
  const url = page.url();
  if (url && /\/notebook\//.test(url) && !url.includes("addSource=true")) {
    const u = new URL(url);
    u.searchParams.set("addSource", "true");
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page
      .locator(Selectors.sources.overlayPane)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    return;
  }

  throw new Error('Could not open the "Add source" dialog');
}

async function isOverlayVisible(page: Page): Promise<boolean> {
  return page
    .locator(Selectors.sources.overlayPane)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

/**
 * "Upload files": the button opens a native file chooser (no `<input>` is
 * mounted beforehand). The dialog closes by itself after the selection and
 * each file becomes one source.
 */
async function uploadFiles(page: Page, filePaths: string[]): Promise<AddSourceResult> {
  if (filePaths.length === 0) throw new Error('`file_paths` is required for type "file".');
  for (const p of filePaths) {
    if (!path.isAbsolute(p)) throw new Error(`File path must be absolute: ${p}`);
    await fs.access(p).catch(() => {
      throw new Error(`File not found: ${p}`);
    });
  }
  const before = await countSources(page);
  const overlay = page.locator(Selectors.sources.overlayPane).first();
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
  await overlay
    .locator(joinAlt(Selectors.sources.sourceTypeFile.filter((s) => !s.startsWith("input"))))
    .first()
    .click();
  const chooser = await chooserPromise;
  if (filePaths.length > 1 && !chooser.isMultiple()) {
    throw new Error("This upload dialog accepts one file at a time — call add_source per file.");
  }
  await chooser.setFiles(filePaths);
  await reportProgress(`Uploading ${filePaths.length} file(s)…`, 1, filePaths.length + 1);
  await waitForOverlayToClose(page);
  // Uploads are processed server-side; give them longer than URL crawls.
  const deadline = Date.now() + 180_000;
  let after = await countSources(page);
  let reported = after;
  while (after < before + filePaths.length && Date.now() < deadline) {
    await safeSleep(page, 1_000);
    after = await countSources(page);
    if (after !== reported) {
      reported = after;
      await reportProgress(
        `${after - before} of ${filePaths.length} file(s) processed`,
        1 + (after - before),
        filePaths.length + 1
      );
    }
  }
  const ok = after >= before + filePaths.length;
  return {
    success: ok,
    type: "file",
    sourceCountBefore: before,
    sourceCountAfter: after,
    ...(ok
      ? {}
      : {
          message:
            `Uploaded ${filePaths.length} file(s) but the source list grew by ${after - before} ` +
            "within 180 s — processing may still be running, or a file type was rejected.",
        }),
  };
}

async function pickSourceType(page: Page, type: SourceType): Promise<void> {
  const candidates =
    type === "url" || type === "youtube"
      ? Selectors.sources.sourceTypeUrl
      : Selectors.sources.sourceTypeText;
  const overlay = page.locator(Selectors.sources.overlayPane).first();
  for (const sel of candidates) {
    const target = overlay.locator(sel).first();
    if (await target.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await target.click();
      // Sub-dialog needs a moment to hydrate before we type.
      await safeSleep(page, 500);
      return;
    }
  }
  // Older overlays drop straight to the input (no type picker) — that's fine.
  // But if a picker *is* showing and none of our candidates matched, typing
  // now would land in the dialog's web-source search box and kick off a web
  // search instead of adding the source. Bail out instead.
  const pickerVisible = await overlay
    .locator("button:is(.source-action-button, .drop-zone-icon-button)")
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (pickerVisible) {
    throw new Error(
      `Could not find the "${type}" source-type button in the Add-source dialog. ` +
        "NotebookLM UI may have changed."
    );
  }
}

async function fillSourceContent(page: Page, input: AddSourceInput): Promise<void> {
  const overlay = page.locator(Selectors.sources.overlayPane).first();

  // Wait for the overlay to actually contain a textarea (the picker swap is
  // animated, so a tight 500 ms wait beats a busy poll).
  await safeSleep(page, 500);

  const inputCandidates = [
    Selectors.sources.overlayTextarea,
    Selectors.sources.overlayInput,
    `${Selectors.sources.overlayPane} textarea:not(.query-box-input):not(.query-box-textarea)`,
  ];

  let target = null;
  for (const sel of inputCandidates) {
    const candidate = page.locator(sel).first();
    if (await candidate.isVisible({ timeout: 2_000 }).catch(() => false)) {
      target = candidate;
      break;
    }
  }

  if (!target) {
    throw new Error(
      "Could not find an input field inside the Add-source overlay. " +
        "NotebookLM UI may have changed — please file an issue."
    );
  }

  // Title goes in a separate input when one is present; otherwise we prefix
  // it onto the text content (Fork's fallback for older overlays).
  let body = input.content;
  if (input.title && input.type === "text") {
    let titleInputFound = false;
    const titleSelectors = [
      'input[placeholder*="title" i]',
      'input[placeholder*="name" i]',
      'input[name="title"]',
      `${Selectors.sources.overlayPane} input[type="text"]:not([readonly])`,
    ];
    for (const sel of titleSelectors) {
      const candidate = overlay.locator(sel).first();
      if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
        await candidate.fill(input.title).catch(() => undefined);
        titleInputFound = true;
        break;
      }
    }
    if (!titleInputFound) {
      body = `${input.title}\n\n${input.content}`;
    }
  }

  await target.fill(body);
  // Small settle delay before clicking submit; Material's primary button
  // briefly stays disabled after `fill()` while validators run.
  await safeSleep(page, 300);
}

async function confirmInsert(page: Page): Promise<void> {
  const overlay = page.locator(Selectors.sources.overlayPane).first();
  for (const sel of Selectors.sources.insertConfirm) {
    const btn = overlay.locator(sel).first();
    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) continue;
      await btn.click();
      log.info(`  ✅ submit clicked (selector: ${sel})`);
      return;
    }
  }
  // Fallback: pressing Enter in many flows submits the form.
  log.warning("  ⚠️  No insert button matched, pressing Enter as fallback");
  await page.keyboard.press("Enter");
}

/**
 * Wait until the Add-source modal animates away. NotebookLM only appends the
 * new sidebar entry once the modal is fully gone, so we *must* wait here.
 */
async function waitForOverlayToClose(page: Page, timeoutMs: number = 30_000): Promise<void> {
  await page
    .locator(Selectors.sources.overlayPane)
    .first()
    .waitFor({ state: "hidden", timeout: timeoutMs })
    .catch(() => undefined);
}

export async function waitForSourceCountIncrease(
  page: Page,
  before: number,
  timeoutMs: number = 90_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await countSources(page);
    if (current > before) return current;
    await safeSleep(page, 500);
  }
  return await countSources(page);
}

/**
 * Look for an error toast / `[role="alert"]` describing why the upload
 * failed. We filter against Material-icon-name leakage (e.g. `more_vert`),
 * which would otherwise produce nonsense error strings.
 */
async function readDialogError(page: Page): Promise<string | null> {
  const errorSelectors = [
    '[role="alert"]:visible',
    ".error-message:visible",
    ".mdc-snackbar--open",
  ];
  const ICON_LEAKS = ["more_vert", "more_horiz", "open_in_new", "content_copy"];

  for (const sel of errorSelectors) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const txt = (await el.textContent({ timeout: 1_000 }).catch(() => null))?.trim();
      if (!txt || txt.length > 240) continue;
      if (ICON_LEAKS.some((leak) => txt.includes(leak))) continue;
      return txt;
    } catch {
      continue;
    }
  }
  return null;
}
