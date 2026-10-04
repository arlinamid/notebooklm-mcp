/**
 * NotebookLM Audio Overview generation + download (issue #11).
 *
 * 2026-05 Studio UX (verified live in DE/EN locales):
 *   - The "Audio Overview" entry is a `<div role="button">` with a Material-
 *     Symbols `audio_magic_eraser` icon. *One click* on it kicks off
 *     generation; there is no separate "Generate" step unless the user
 *     opens the per-card "Anpassen" sub-dialog first.
 *   - While generating, NotebookLM shows a "Audio-Zusammenfassung wird … —
 *     Kommen Sie in ein paar Minuten wieder" tile with a spinner.
 *   - When generation completes, NotebookLM mounts an `artifact-library-item`
 *     tile with a Play button (`button.artifact-action-button`, locale-bound
 *     aria-label "Wiedergeben"/"Play"/…) and a three-dot menu containing
 *     "Download" / "Herunterladen" / "Télécharger" / …. There is *no real*
 *     `<audio>` element in the DOM.
 *
 * Two operations:
 *   - `generateAudioOverview(page, opts)` — async by default: returns
 *     immediately with `status: "started"` after triggering the generation,
 *     so the caller doesn't block for the 5–10 minute render. Pass
 *     `waitForCompletion: true` for the legacy synchronous behaviour.
 *   - `downloadAudioOverview(page, destDir)` — opens the three-dot menu on
 *     the completed audio tile, clicks the "Download" item, and persists
 *     the file via Patchright's `download` event.
 *
 * Companion: `getAudioStatus(page)` — non-blocking status probe for callers
 * that want to poll without holding open a long-running RPC.
 */

import type { Page } from "patchright";
import path from "path";
import fs from "fs/promises";
import { Selectors, joinAlt } from "./selectors.js";
import { dismissPromoDialogs } from "./dialogs.js";
import { ensureStudioListView } from "./notes.js";
import { abortable, reportProgress } from "../utils/request-context.js";
import {
  fillFocusPrompt,
  pickRadioValue,
  pickToggle,
  selectStudioSources,
  submitStudioForm,
} from "./studio.js";
import { safeSleep, isRecoverable } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

export type AudioStatus = "ready" | "in_progress" | "not_started";

export interface GenerateAudioOptions {
  /** Optional focus prompt fed into the customise dialog before generation. */
  customPrompt?: string;
  /**
   * If `true`, block until the audio tile is ready (legacy behaviour). If
   * `false` (default), return immediately after triggering generation —
   * callers poll via `get_audio_status`.
   */
  waitForCompletion?: boolean;
  /** How long to wait when `waitForCompletion=true`. Default 10 min. */
  timeoutMs?: number;
  /** 2026-09 customise dialog: episode format. Default: NotebookLM's default (deep_dive). */
  format?: AudioFormat;
  /** 2026-09 customise dialog: episode length. Default: NotebookLM's default. */
  length?: AudioLength;
  /**
   * Use "Generate later" instead of "Generate now": queued, does not count
   * against the current limit window, ready within hours.
   */
  generateLater?: boolean;
  /** Restrict the episode to these sources (title, unique substring, or id). */
  sources?: string[];
}

export type AudioFormat = "deep_dive" | "brief" | "critique" | "debate";
export type AudioLength = "short" | "default" | "long";

/** `value` attribute of the format radio inputs — language-independent. */
const AUDIO_FORMAT_VALUES: Record<AudioFormat, string> = {
  deep_dive: "1",
  brief: "2",
  critique: "3",
  debate: "4",
};

export interface AudioGenerationResult {
  status: AudioStatus | "started" | "error";
  /** True when an Audio Overview already existed before this call. */
  alreadyExisted?: boolean;
  message?: string;
}

export async function generateAudioOverview(
  page: Page,
  options: GenerateAudioOptions = {}
): Promise<AudioGenerationResult> {
  const {
    customPrompt,
    waitForCompletion = false,
    timeoutMs = 600_000,
    format,
    length,
    generateLater = false,
    sources,
  } = options;

  try {
    await dismissPromoDialogs(page);
    await ensureStudioListView(page);

    // 1. Idempotency: if the completed audio tile is already mounted, the
    //    user already has an Audio Overview — report ready and do nothing.
    if (await audioIsReady(page)) {
      log.info("  ✅ Audio Overview already generated, skipping click");
      return { status: "ready", alreadyExisted: true };
    }

    // 2. Generation may already be running. Detect the spinner tile and
    //    skip clicking again — duplicate clicks would either be no-ops or
    //    spawn a parallel generation we'd then have to clean up.
    if (await audioGenerationInProgress(page)) {
      log.info("  ⏳ Audio Overview generation already running");
      if (waitForCompletion) {
        return await waitForAudioReady(page, timeoutMs);
      }
      return {
        status: "in_progress",
        message:
          "Audio Overview generation is already running. Poll `get_audio_status` " +
          "every ~30 s — the audio tile usually appears in 2–10 minutes.",
      };
    }

    // 3. The Studio panel can be collapsed by the user — expand it before
    //    we hunt for the card.
    await ensureStudioPanelExpanded(page);

    // 4. Trigger generation.
    //    Legacy UI (≤2026-05) with a separate "customise" button: use it so
    //    the tile click doesn't start an un-prompted generation first.
    if (customPrompt && (await firstVisible(page, LEGACY_CUSTOMISE_SELECTORS))) {
      await openAudioCustomiseDialog(page);
      const overlay = page.locator(Selectors.sources.overlayPane).first();
      const promptField = overlay.locator("textarea, input[type='text']").first();
      if (await promptField.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await promptField.fill(customPrompt);
        await safeSleep(page, 200);
      }
      await clickFirstVisible(page, Selectors.studio.generateButton, "Generate button");
    } else {
      await clickFirstVisible(page, Selectors.studio.audioOverviewButton, "Audio overview entry");

      // 2026-09 UI: the tile opens a customise dialog and nothing is
      // generated until "Generate now" / "Generate later" is clicked.
      // Older UIs started generating on the tile click itself.
      const form = page.locator(Selectors.studio.customiseDialog).first();
      if (await form.isVisible({ timeout: 5_000 }).catch(() => false)) {
        if (sources) {
          try {
            await selectStudioSources(page, sources);
          } catch (err) {
            await page.keyboard.press("Escape").catch(() => undefined);
            return { status: "error", message: err instanceof Error ? err.message : String(err) };
          }
        }
        await fillAudioForm(page, { customPrompt, format, length });
        const submitted = await submitStudioForm(page, generateLater);
        if (!submitted.ok) {
          return { status: "error", message: submitted.message };
        }
      }
    }

    log.info(`  🎙️  Audio Overview generation triggered${generateLater ? " (queued)" : ""}`);

    if (generateLater) {
      return {
        status: "started",
        message:
          'Audio Overview queued via "Generate later" — it does not use the current ' +
          "limit window and is usually ready within hours. Poll `get_audio_status`.",
      };
    }

    // 5. Either return immediately (default async mode) or block until ready.
    if (!waitForCompletion) {
      return {
        status: "started",
        message:
          "Audio Overview generation started. It typically takes 2–10 minutes. " +
          "Poll `get_audio_status` to check completion, then call `download_audio`.",
      };
    }

    return await waitForAudioReady(page, timeoutMs);
  } catch (err) {
    if (isRecoverable(err)) throw err;
    log.warning(`  ⚠️  Audio generation failed: ${err}`);
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function waitForAudioReady(page: Page, timeoutMs: number): Promise<AudioGenerationResult> {
  const tile = page.locator(joinAlt(Selectors.studio.audioPlayer)).first();
  // Minutes-long wait: report progress and stop when the client cancels.
  const started = Date.now();
  const ticker = setInterval(() => {
    const min = Math.round((Date.now() - started) / 60_000);
    void reportProgress(`Waiting for the Audio Overview (${min} min elapsed)…`);
  }, 30_000);
  try {
    await abortable(tile.waitFor({ state: "visible", timeout: timeoutMs }));
  } finally {
    clearInterval(ticker);
  }
  return { status: "ready" };
}

/**
 * Non-blocking status probe used by the `get_audio_status` MCP tool.
 */
export async function getAudioStatusOnPage(page: Page): Promise<AudioGenerationResult> {
  try {
    if (await audioIsReady(page)) {
      return { status: "ready" };
    }
    if (await audioGenerationInProgress(page)) {
      return {
        status: "in_progress",
        message: "Audio Overview is still being generated.",
      };
    }
    return {
      status: "not_started",
      message: "No Audio Overview exists yet for this notebook.",
    };
  } catch (err) {
    if (isRecoverable(err)) throw err;
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function audioIsReady(page: Page): Promise<boolean> {
  return page
    .locator(joinAlt(Selectors.studio.audioPlayer))
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

/**
 * Detect a generation-in-progress tile. NotebookLM renders a tile with a
 * spinner and a localised "come back in a few minutes" message while it
 * works. Coverage spans EN, DE, FR, ES, IT, PT, NL, JA.
 */
const GENERATION_IN_PROGRESS_PHRASES = [
  // English
  "check back in a few minutes",
  "come back in a few minutes",
  "generating audio overview",
  "audio overview is being generated",
  "generating your audio",
  // German
  "kommen sie in ein paar minuten wieder",
  "audio-zusammenfassung wird erstellt",
  "audio-zusammenfassung wird gener",
  // French
  "revenez dans quelques minutes",
  "génération de l'aperçu audio",
  // Spanish
  "vuelve en unos minutos",
  "generando el resumen de audio",
  // Italian
  "torna tra qualche minuto",
  "generazione della panoramica audio",
  // Portuguese
  "volte em alguns minutos",
  "gerando a visão geral de áudio",
  // Dutch
  "kom over een paar minuten terug",
  "audio-overzicht wordt gegenereerd",
  // Japanese
  "数分後にもう一度ご確認ください",
  "音声の概要を生成しています",
];

async function audioGenerationInProgress(page: Page): Promise<boolean> {
  // 2026-09 UI: generating tile in the Studio library (language-free anchor).
  if (
    await page
      .locator(joinAlt(Selectors.studio.audioGenerating))
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false)
  ) {
    return true;
  }
  try {
    const studioText = await page
      .locator(".studio-panel, studio-panel")
      .first()
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (!studioText) return false;
    const lower = studioText.toLowerCase();
    return GENERATION_IN_PROGRESS_PHRASES.some((p) => lower.includes(p));
  } catch {
    return false;
  }
}

/**
 * The Studio panel can be collapsed via the dock-arrow icon. When collapsed
 * the cards aren't in the DOM at all; click the expand-arrow first.
 */
async function ensureStudioPanelExpanded(page: Page): Promise<void> {
  const cardVisible = await page
    .locator(joinAlt(Selectors.studio.audioOverviewButton))
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (cardVisible) return;

  const expandSelectors = [
    'button:has(mat-icon:text-is("dock_to_left"))',
    'button[aria-label*="erweitern" i][aria-label*="studio" i]',
    'button[aria-label*="expand" i][aria-label*="studio" i]',
    'button[aria-label*="ouvrir" i][aria-label*="studio" i]',
    'button[aria-label*="abrir" i][aria-label*="studio" i]',
    'button[aria-label*="aprire" i][aria-label*="studio" i]',
  ];
  for (const sel of expandSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => undefined);
      await safeSleep(page, 400);
      return;
    }
  }
}

async function fillAudioForm(
  page: Page,
  opts: { customPrompt?: string; format?: AudioFormat; length?: AudioLength }
): Promise<void> {
  if (opts.format && !(await pickRadioValue(page, AUDIO_FORMAT_VALUES[opts.format]))) {
    log.warning(`  ⚠️  Audio format "${opts.format}" not found in dialog, using default`);
  }
  // The audio dialog has a single toggle group: Length (Short | Default [| Long]).
  if (opts.length) {
    const idx = opts.length === "short" ? 0 : opts.length === "default" ? 1 : 2;
    if (!(await pickToggle(page, 0, idx))) {
      log.warning(`  ⚠️  Audio length "${opts.length}" not offered, using default`);
    }
  }
  if (opts.customPrompt && !(await fillFocusPrompt(page, opts.customPrompt))) {
    log.warning("  ⚠️  Focus prompt field not found in Audio dialog");
  }
}

async function firstVisible(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const sel of selectors) {
    if (
      await page
        .locator(sel)
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false)
    )
      return true;
  }
  return false;
}

/** Pre-2026-09 "customise audio" buttons (separate from the tile itself). */
const LEGACY_CUSTOMISE_SELECTORS = [
  'button[aria-label*="audio-zusammenfassung anpassen" i]',
  'button[aria-label*="audio" i][aria-label*="anpassen" i]',
  'button[aria-label*="customise audio" i]',
  'button[aria-label*="customize audio" i]',
  'button[aria-label*="personnaliser" i][aria-label*="audio" i]',
  'button[aria-label*="personalizar" i][aria-label*="audio" i]',
  'button[aria-label*="personalizza" i][aria-label*="audio" i]',
];

async function openAudioCustomiseDialog(page: Page): Promise<void> {
  const customiseSelectors = [
    'button[aria-label*="audio-zusammenfassung anpassen" i]',
    'button[aria-label*="audio" i][aria-label*="anpassen" i]',
    'button[aria-label*="customise audio" i]',
    'button[aria-label*="customize audio" i]',
    'button[aria-label*="personnaliser" i][aria-label*="audio" i]',
    'button[aria-label*="personalizar" i][aria-label*="audio" i]',
    'button[aria-label*="personalizza" i][aria-label*="audio" i]',
  ];
  await clickFirstVisible(page, customiseSelectors, "Audio customise button");
}

export interface DownloadAudioResult {
  success: boolean;
  filePath?: string;
  message?: string;
}

/**
 * Download the completed Audio Overview. Strategy:
 *   1. Verify the audio tile exists (else surface a clear error).
 *   2. Click the per-tile three-dot "Mehr"/"More" button to open the menu.
 *   3. Click the "Download" / "Herunterladen" / … menu item.
 *   4. Capture the resulting `download` event and save to `destinationDir`.
 */
export async function downloadAudioOverview(
  page: Page,
  destinationDir: string,
  preferredFileName: string = "notebooklm-audio.wav"
): Promise<DownloadAudioResult> {
  try {
    if (!(await audioIsReady(page))) {
      return {
        success: false,
        message:
          "No completed Audio Overview found. Trigger `generate_audio` first " +
          "and wait for `get_audio_status` to report `ready`.",
      };
    }

    // Open the three-dot menu on the audio tile.
    await dismissPromoDialogs(page);
    await ensureStudioListView(page);
    await clickFirstVisible(page, Selectors.studio.audioMoreMenuButton, "Audio more-menu button");
    await safeSleep(page, 250);

    // 2026-09 UI: "Download" opens a popup that redirects to
    // drum.usercontent.google.com and downloads *there* — and headless Chrome
    // then tears down the whole persistent context. So: capture the popup's
    // first URL, abort it before it downloads, and fetch the file with the
    // context's own HTTP client (same cookies). Legacy UIs fire `download`
    // on the page itself; race both.
    const context = page.context();
    let onPopup: ((p: Page) => Promise<void>) | null = null;
    const popupUrl = new Promise<string>((resolve) => {
      onPopup = async (popup: Page) => {
        await popup
          .route("**/*", async (route) => {
            const req = route.request();
            if (req.isNavigationRequest() && /^https:/.test(req.url())) {
              resolve(req.url());
              await route.abort().catch(() => undefined);
              await popup.close().catch(() => undefined);
              return;
            }
            await route.continue().catch(() => undefined);
          })
          .catch(() => undefined);
      };
      context.once("page", onPopup);
    });
    const pageDownload = page.waitForEvent("download", { timeout: 60_000 });
    pageDownload.catch(() => undefined);

    try {
      await clickFirstVisible(
        page,
        Selectors.studio.audioDownloadMenuItem,
        "Audio download menu item"
      );

      const winner = await Promise.race([
        popupUrl.then((url) => ({ kind: "url" as const, url })),
        pageDownload.then((download) => ({ kind: "download" as const, download })),
      ]);

      if (winner.kind === "download") {
        const suggested = winner.download.suggestedFilename();
        const targetPath = path.join(destinationDir, suggested || preferredFileName);
        await winner.download.saveAs(targetPath);
        return { success: true, filePath: targetPath };
      }

      const resp = await context.request.get(winner.url, { timeout: 180_000, maxRedirects: 10 });
      if (!resp.ok()) {
        return { success: false, message: `Audio download failed: HTTP ${resp.status()}` };
      }
      const body = await resp.body();
      const fileName =
        fileNameFromDisposition(resp.headers()["content-disposition"]) ??
        preferredFileName.replace(/\.wav$/, ".m4a");
      const targetPath = path.join(destinationDir, fileName);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(targetPath, body);
      log.success(`  ✅ Audio saved: ${targetPath} (${body.length} bytes)`);
      return { success: true, filePath: targetPath };
    } finally {
      if (onPopup) context.off("page", onPopup);
    }
  } catch (err) {
    if (isRecoverable(err)) throw err;
    log.warning(`  ⚠️  Audio download failed: ${err}`);
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * File name from a Content-Disposition header. Google sends raw UTF-8 bytes in
 * `filename="…"`, which arrive latin1-decoded — re-decode them. Path
 * separators are stripped so the name can't escape `destinationDir`.
 */
function fileNameFromDisposition(header: string | undefined): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  let name: string | null = null;
  if (star) {
    try {
      name = decodeURIComponent(star[1].replace(/"/g, "").trim());
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = header.match(/filename="?([^";]+)"?/i);
    if (plain) name = Buffer.from(plain[1], "latin1").toString("utf8");
  }
  if (!name) return null;
  const safe = path.basename(name.replace(/[\\/]/g, "_")).trim();
  return safe || null;
}

async function clickFirstVisible(
  page: Page,
  selectors: readonly string[],
  label: string
): Promise<void> {
  for (const sel of selectors) {
    const candidate = page.locator(sel).first();
    if (await candidate.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await candidate.click();
      await safeSleep(page, 300);
      return;
    }
  }
  throw new Error(
    `Could not find ${label} — selectors: ${selectors.join(" | ")}. ` +
      "NotebookLM Studio UI may have changed."
  );
}
