/**
 * Shared helpers for the 2026-09 Studio customise dialogs.
 *
 * Every Studio tile (Audio, Video, Slide Deck, Mind Map, Flashcards, Quiz,
 * Infographic, Data Table) opens a `<configurable-form-dialog>`; Reports
 * opens a `<report-customization-dialog>`. Nothing is generated until one of
 * the two footer buttons is clicked:
 *
 *   - "Generate now"   — `nb-button.nb-button-type-tonal`, uses the current
 *                        limit window.
 *   - "Generate later" — `nb-button.nb-button-type-on-surface`, queued, does
 *                        not use the current limit, ready within hours.
 *
 * The footer also carries a usage meter
 * (`expected-usage [role=progressbar][aria-valuenow]`, percent used).
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { safeSleep } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";
import { ensureStudioListView } from "./notes.js";
import { resolveSourceIds } from "./source-select.js";
import { resolveLanguage } from "./language.js";

/**
 * Studio output types. `icon` is the Material-Symbols glyph used both on the
 * create tile and on finished library items (language-free); `label` is the
 * EN aria-label fallback.
 */
export const STUDIO_TYPES = {
  audio: { icon: "audio_spark", legacyIcon: "audio_magic_eraser", label: "Audio Overview" },
  video: { icon: "videocam", label: "Video Overview" },
  slide_deck: { icon: "tablet", label: "Slide Deck" },
  mind_map: { icon: "flowchart", label: "Mind Map" },
  report: { icon: "auto_tab_group", label: "Reports" },
  flashcards: { icon: "copy", label: "Flashcards" },
  quiz: { icon: "quiz", label: "Quiz" },
  infographic: { icon: "stacked_bar_chart", label: "Infographic" },
  data_table: { icon: "format_list_bulleted", label: "Data Table" },
} as const satisfies Record<string, { icon: string; label: string; legacyIcon?: string }>;

export type StudioType = keyof typeof STUDIO_TYPES;

/** Glyph shown on a library item while it is still generating. */
const GENERATING_ICON = "progress_activity";

export interface StudioArtifact {
  /** Stable id (from the `artifact-labels-<uuid>` / `note-labels-<uuid>` element). */
  id: string;
  /** `note` = saved chat answer / manual note (convertible to a source). */
  type: StudioType | "note" | "unknown";
  title: string;
  details: string;
  /**
   * `scheduled` = queued via "Generate later" (grey glyph, disabled, e.g.
   * "Scheduled for after 11pm"); `generating` = spinning `progress_activity`.
   */
  status: "ready" | "generating" | "scheduled";
}

/** List the items in the Studio library (finished and generating). */
export async function listStudioArtifacts(page: Page): Promise<StudioArtifact[]> {
  const iconToType: Record<string, string> = {};
  for (const [type, def] of Object.entries(STUDIO_TYPES)) {
    iconToType[def.icon] = type;
    if ("legacyIcon" in def) iconToType[def.legacyIcon] = type;
  }
  const labelToType: Record<string, string> = {};
  for (const [type, def] of Object.entries(STUDIO_TYPES)) labelToType[def.label] = type;

  await ensureStudioListView(page);
  const raw = await page
    .locator("artifact-library-item, artifact-library-note")
    .evaluateAll((items) =>
      items.map((el) => ({
        isNote: el.tagName.toLowerCase() === "artifact-library-note",
        id: (el.querySelector("[id^='artifact-labels-'], [id^='note-labels-']")?.id ?? "").replace(
          /^(artifact|note)-labels-/,
          ""
        ),
        icon: el.querySelector("mat-icon.artifact-icon")?.textContent?.trim() ?? "",
        description:
          el.querySelector("button.artifact-stretched-button")?.getAttribute("aria-description") ??
          "",
        disabled: el.querySelector("button.artifact-stretched-button")?.hasAttribute("disabled"),
        grey: el.querySelector("mat-icon.artifact-icon")?.classList.contains("grey-icon") ?? false,
        title: el.querySelector(".artifact-title")?.textContent?.trim() ?? "",
        details: (el.querySelector(".artifact-details")?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      }))
    )
    .catch(() => []);

  return raw.map((r) => {
    if (r.isNote) {
      return {
        id: r.id,
        type: "note" as const,
        title: r.title,
        details: r.details,
        status: "ready" as const,
      };
    }
    const status: StudioArtifact["status"] =
      r.icon === GENERATING_ICON
        ? "generating"
        : r.disabled && r.grey
          ? "scheduled"
          : r.disabled
            ? "generating"
            : "ready";
    const type = (iconToType[r.icon] ?? labelToType[r.description] ?? "unknown") as
      | StudioType
      | "unknown";
    return { id: r.id, type, title: r.title, details: r.details, status };
  });
}

/** Locate the create tile for a Studio type (icon first, EN aria-label fallback). */
function studioTile(page: Page, type: StudioType) {
  const def = STUDIO_TYPES[type];
  const icons = "legacyIcon" in def ? [def.icon, def.legacyIcon] : [def.icon];
  const selectors = [
    ...icons.map((i) => `.create-artifact-button-container:has(mat-icon:text-is("${i}"))`),
    `.create-artifact-button-container[aria-label="${def.label}"]`,
  ];
  return page.locator(selectors.join(", ")).first();
}

export interface GenerateStudioOptions {
  type: StudioType;
  /** Free-text focus / description for the artifact. */
  prompt?: string;
  /** Use "Generate later" (queued, outside the current limit window). */
  generateLater?: boolean;
  /** Type-specific dialog settings; validated per type. */
  options?: StudioOptions;
}

export interface GenerateStudioResult {
  status: "started" | "queued" | "error";
  message?: string;
  usagePercent?: number | null;
  /** Source titles actually selected, when `sources` was given. */
  sources?: string[];
  /** Id of the new Studio item (RPC path; matches list_studio_artifacts). */
  artifactId?: string;
}

// ---------------------------------------------------------------------------
// Per-type dialog options (verified live 2026-10). Radio groups are addressed
// by their input `value`, toggle groups by position — both language-free.
// ---------------------------------------------------------------------------

type ToggleKind = "length" | "count" | "difficulty" | "images" | "orientation" | "detail";

const TOGGLE_OPTIONS: Record<ToggleKind, Record<string, number>> = {
  length: { short: 0, default: 1, long: 2 },
  count: { fewer: 0, standard: 1, more: 2 },
  difficulty: { easy: 0, medium: 1, hard: 2 },
  images: { include: 0, text_only: 1 },
  orientation: { landscape: 0, portrait: 1, square: 2 },
  detail: { concise: 0, standard: 1, detailed: 2 },
};

interface TypeSpec {
  /** Format tiles (radio `value`s). */
  formats?: Record<string, string>;
  /** Infographic visual styles (radio `value`s). */
  styles?: Record<string, string>;
  /** Toggle groups in DOM order. */
  toggles: ToggleKind[];
  language: boolean;
}

const TYPE_SPECS: Record<Exclude<StudioType, "report">, TypeSpec> = {
  audio: {
    formats: { deep_dive: "1", brief: "2", critique: "3", debate: "4" },
    toggles: ["length"],
    language: true,
  },
  video: { formats: { cinematic: "3", short: "4", explainer: "1" }, toggles: [], language: false },
  slide_deck: { formats: { detailed: "1", presenter: "2" }, toggles: ["length"], language: true },
  infographic: {
    styles: {
      auto: "1",
      sketch_note: "2",
      professional: "3",
      bento_grid: "4",
      editorial: "5",
      instructional: "6",
      bricks: "7",
      clay: "8",
      anime: "9",
      kawaii: "10",
      scientific: "11",
    },
    toggles: ["orientation", "detail"],
    language: true,
  },
  flashcards: { toggles: ["count", "difficulty", "images"], language: true },
  quiz: { toggles: ["count", "difficulty"], language: true },
  mind_map: { toggles: [], language: true },
  data_table: { toggles: [], language: true },
};

/** Report: format cards (by position) and templates (by position per format). */
const REPORT_FORMATS = { interactive: 0, document: 1 } as const;
const REPORT_TEMPLATES = {
  learning_overview: { format: "interactive", index: 0 },
  create_your_own: { format: "document", index: 0 },
  briefing_doc: { format: "document", index: 1 },
  study_guide: { format: "document", index: 2 },
  blog_post: { format: "document", index: 3 },
} as const;
export type ReportTemplate = keyof typeof REPORT_TEMPLATES;

/** Optional, type-specific Studio settings (snake_case = tool argument names). */
export interface StudioOptions {
  format?: string;
  length?: string;
  count?: string;
  difficulty?: string;
  include_images?: boolean;
  orientation?: string;
  detail?: string;
  style?: string;
  /** Output language as shown in the dialog's own name, e.g. "English", "magyar", "Deutsch". */
  language?: string;
  template?: ReportTemplate;
  /**
   * Restrict the job to these sources (UUID, exact title, or unique title
   * substring). Omit to use every source of the notebook. Not available for
   * reports.
   */
  sources?: string[];
}

/** Validate options against the type before touching the UI. */
export function validateStudioOptions(type: StudioType, o: StudioOptions): string | null {
  const used = Object.entries(o)
    .filter(([k, v]) => v !== undefined && k !== "sources")
    .map(([k]) => k);
  if (o.sources !== undefined) {
    if (type === "report") return "report has no source selector — omit `sources`";
    if (!Array.isArray(o.sources) || o.sources.length === 0)
      return "`sources` must be a non-empty list of source titles or ids";
  }
  if (type === "report") {
    const allowed = ["format", "template", "language"];
    const bad = used.filter((k) => !allowed.includes(k));
    if (bad.length) return `report supports only: ${allowed.join(", ")} (got ${bad.join(", ")})`;
    if (o.format && !(o.format in REPORT_FORMATS))
      return `report format must be one of: ${Object.keys(REPORT_FORMATS).join(", ")}`;
    if (o.template && !(o.template in REPORT_TEMPLATES))
      return `report template must be one of: ${Object.keys(REPORT_TEMPLATES).join(", ")}`;
    if (o.format && o.template && REPORT_TEMPLATES[o.template].format !== o.format)
      return `template "${o.template}" belongs to the "${REPORT_TEMPLATES[o.template].format}" format`;
    return null;
  }
  const spec = TYPE_SPECS[type];
  const toggleArg: Record<ToggleKind, keyof StudioOptions> = {
    length: "length",
    count: "count",
    difficulty: "difficulty",
    images: "include_images",
    orientation: "orientation",
    detail: "detail",
  };
  const allowed = [
    ...(spec.formats ? ["format"] : []),
    ...(spec.styles ? ["style"] : []),
    ...spec.toggles.map((t) => toggleArg[t]),
    ...(spec.language ? ["language"] : []),
  ];
  const bad = used.filter((k) => !allowed.includes(k));
  if (bad.length)
    return `${type} supports: ${allowed.join(", ") || "(no options besides prompt)"} (got ${bad.join(", ")})`;
  if (o.format && spec.formats && !(o.format in spec.formats))
    return `${type} format must be one of: ${Object.keys(spec.formats).join(", ")}`;
  if (o.style && spec.styles && !(o.style in spec.styles))
    return `infographic style must be one of: ${Object.keys(spec.styles).join(", ")}`;
  for (const t of spec.toggles) {
    if (t === "images") continue;
    const v = o[toggleArg[t]] as string | undefined;
    if (v !== undefined && !(v in TOGGLE_OPTIONS[t]))
      return `${toggleArg[t]} must be one of: ${Object.keys(TOGGLE_OPTIONS[t]).join(", ")}`;
  }
  return null;
}

/** One option of a Studio type, described for a user-facing form. */
export interface StudioOptionField {
  arg: keyof StudioOptions;
  title: string;
  kind: "enum" | "boolean" | "string";
  values?: string[];
}

const pretty = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The options the dialog of `type` offers, for building an elicitation form. */
export function studioOptionFields(type: StudioType): StudioOptionField[] {
  if (type === "report") {
    return [
      { arg: "template", title: "Template", kind: "enum", values: Object.keys(REPORT_TEMPLATES) },
      { arg: "language", title: "Output language (e.g. English, magyar)", kind: "string" },
    ];
  }
  const spec = TYPE_SPECS[type];
  const fields: StudioOptionField[] = [];
  if (spec.formats)
    fields.push({
      arg: "format",
      title: "Format",
      kind: "enum",
      values: Object.keys(spec.formats),
    });
  if (spec.styles)
    fields.push({
      arg: "style",
      title: "Visual style",
      kind: "enum",
      values: Object.keys(spec.styles),
    });
  for (const t of spec.toggles) {
    if (t === "images")
      fields.push({ arg: "include_images", title: "Include images", kind: "boolean" });
    else
      fields.push({
        arg: t,
        title: pretty(t),
        kind: "enum",
        values: Object.keys(TOGGLE_OPTIONS[t]),
      });
  }
  if (spec.language)
    fields.push({
      arg: "language",
      title: "Output language (e.g. English, magyar)",
      kind: "string",
    });
  return fields;
}

export { pretty as prettyOptionValue };

async function applyTypeOptions(page: Page, type: Exclude<StudioType, "report">, o: StudioOptions) {
  const spec = TYPE_SPECS[type];
  if (o.format && spec.formats && !(await pickRadioValue(page, spec.formats[o.format])))
    throw new Error(`Format "${o.format}" not offered in the ${type} dialog.`);
  if (o.style && spec.styles && !(await pickRadioValue(page, spec.styles[o.style])))
    throw new Error(`Style "${o.style}" not offered in the infographic dialog.`);
  for (const [groupIndex, kind] of spec.toggles.entries()) {
    const value =
      kind === "images"
        ? o.include_images === undefined
          ? undefined
          : o.include_images
            ? "include"
            : "text_only"
        : ((o as Record<string, unknown>)[kind === "length" ? "length" : kind] as
            | string
            | undefined);
    if (value === undefined) continue;
    if (!(await pickToggle(page, groupIndex, TOGGLE_OPTIONS[kind][value])))
      throw new Error(`Option ${kind}="${value}" not offered in the ${type} dialog.`);
  }
  if (o.language) await pickLanguage(page, o.language);
}

/**
 * Restrict a Studio job to some of the notebook's sources. The "N sources"
 * button swaps the dialog to a picker sub-view (`mat-selection-list`, one
 * `mat-list-option` per source with the source UUID in `data-value`) whose
 * footer button "Confirm" sits exactly where "Generate now" is — so confirm
 * and wait for the main view to return before anything else is clicked.
 *
 * `wanted` entries match a source UUID, then the exact name, then a unique
 * case-insensitive substring. Returns the names of the selected sources.
 */
export async function selectStudioSources(page: Page, wanted: string[]): Promise<string[]> {
  const dialog = page.locator(Selectors.studio.customiseDialog).first();
  const trigger = dialog.locator(Selectors.studio.sourcesTrigger).first();
  if (!(await trigger.isVisible({ timeout: 1_500 }).catch(() => false))) {
    throw new Error("This Studio dialog has no source selector.");
  }
  await trigger.click();
  const options = dialog.locator(Selectors.studio.sourcesOption);
  await options.first().waitFor({ state: "visible", timeout: 5_000 });

  const items = await options.evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-value") ?? "",
      name: e.querySelector(".item-name")?.textContent?.trim() ?? "",
      selected: e.getAttribute("aria-selected") === "true",
    }))
  );

  const ids = await resolveSourceIds(
    items.map((i) => ({ id: i.id, title: i.name })),
    wanted
  );

  for (const item of items) {
    if (ids.has(item.id) !== item.selected) {
      await dialog.locator(`${Selectors.studio.sourcesOption}[data-value="${item.id}"]`).click();
      await safeSleep(page, 150);
    }
  }

  const after = await options.evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-value") ?? "",
      name: e.querySelector(".item-name")?.textContent?.trim() ?? "",
      selected: e.getAttribute("aria-selected") === "true",
    }))
  );
  const mismatch = after.filter((i) => ids.has(i.id) !== i.selected);
  if (mismatch.length) {
    throw new Error(
      `Could not set source selection for: ${mismatch.map((i) => i.name).join(", ")}`
    );
  }

  // "Confirm" returns to the main form; it must not be mistaken for "Generate now".
  let confirmed = false;
  for (const sel of Selectors.studio.sourcesConfirmButton) {
    const btn = dialog.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      confirmed = true;
      break;
    }
  }
  if (!confirmed) throw new Error('Could not find the source picker\'s "Confirm" button.');
  await trigger.waitFor({ state: "visible", timeout: 5_000 });
  await safeSleep(page, 300);
  return after.filter((i) => i.selected).map((i) => i.name);
}

/** Choose an entry of the dialog's language `mat-select` by its visible name. */
export async function pickLanguage(page: Page, language: string): Promise<void> {
  const select = page
    .locator(Selectors.studio.customiseDialog)
    .first()
    .locator("mat-select")
    .first();
  if (!(await select.isVisible({ timeout: 1_000 }).catch(() => false)))
    throw new Error("This dialog has no language selector.");
  await select.click();
  const options = page.locator("mat-option");
  await options.first().waitFor({ state: "visible", timeout: 3_000 });
  const texts = (await options.allInnerTexts()).map((t) => t.trim());
  // The dialog lists own names ("magyar"); accept codes and English names too.
  // Only exact names or "magyar (default)"-style suffixes match — a bare
  // prefix let "ja" pick "Jawa".
  const wants = [language, resolveLanguage(language)?.name]
    .filter((w): w is string => !!w)
    .map((w) => w.trim().toLowerCase());
  const name =
    texts.find((t) => wants.includes(t.toLowerCase())) ??
    texts.find((t) => wants.some((w) => t.toLowerCase().startsWith(`${w} (`)));
  if (!name) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(
      `Language "${language}" not offered. Use the name as NotebookLM lists it, e.g. ` +
        texts.slice(0, 12).join(", ") +
        ", …"
    );
  }
  // Click by text, not index: the long option list re-renders while it
  // scrolls, so an nth() click can land on a different language.
  await options
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`) })
    .first()
    .click();
  await safeSleep(page, 300);
  const chosen = ((await select.innerText().catch(() => "")) || "").trim();
  if (!chosen.toLowerCase().startsWith(name.toLowerCase().replace(/\s*\(.*\)$/, ""))) {
    throw new Error(`Language selection failed: wanted "${name}", dialog shows "${chosen}".`);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Report dialog (`report-customization-dialog`): pick a format card, pick a
 * template (selection only — no request), and when a prompt or language is
 * given open the template's editor (pencil) or "Create your own".
 */
async function applyReportOptions(page: Page, o: StudioOptions, prompt?: string): Promise<void> {
  const dialog = page.locator(Selectors.studio.customiseDialog).first();
  const template: ReportTemplate =
    o.template ??
    ((o.format ?? "interactive") === "interactive"
      ? "learning_overview"
      : prompt
        ? "create_your_own"
        : "briefing_doc");
  const tpl = REPORT_TEMPLATES[template];

  if (
    !(await domClickPath(page, Selectors.studio.customiseDialog, [
      { sel: Selectors.studio.reportFormatCard, index: REPORT_FORMATS[tpl.format] },
    ]))
  ) {
    throw new Error(`Report format "${tpl.format}" not found in the dialog.`);
  }
  await safeSleep(page, 1_200);

  await dialog
    .locator(Selectors.studio.reportTemplateButton)
    .first()
    .waitFor({ state: "visible", timeout: 5_000 });
  if (
    !(await domClickPath(page, Selectors.studio.customiseDialog, [
      { sel: Selectors.studio.reportTemplateButton, index: tpl.index },
    ]))
  ) {
    throw new Error(`Report template "${template}" not found in the dialog.`);
  }
  await safeSleep(page, 600);

  if (template === "create_your_own" || prompt || o.language) {
    // "Create your own" opens the editor directly; other templates via their pencil.
    if (template !== "create_your_own") {
      await dialog.locator(Selectors.studio.reportSelectedTemplateEdit).first().click();
    }
    const field = dialog.locator("textarea").first();
    await field.waitFor({ state: "visible", timeout: 5_000 });
    if (prompt) {
      // Templates come pre-filled with their own instructions — keep them and
      // append the caller's focus; "Create your own" starts empty.
      const current = (await field.inputValue().catch(() => "")).trim();
      await field.fill(current ? `${current}\n\n${prompt}` : prompt);
      await safeSleep(page, 200);
    } else if (template === "create_your_own") {
      throw new Error('Report template "create_your_own" needs a `prompt`.');
    }
    if (o.language) await pickLanguage(page, o.language);
  }
}

/**
 * Open a Studio tile's customise dialog, apply the type's options and the
 * focus prompt, and submit with "Generate now" / "Generate later".
 */
export async function generateStudioArtifact(
  page: Page,
  opts: GenerateStudioOptions
): Promise<GenerateStudioResult> {
  const studioOptions = opts.options ?? {};
  const invalid = validateStudioOptions(opts.type, studioOptions);
  if (invalid) return { status: "error", message: invalid };
  await ensureStudioListView(page);

  const tile = studioTile(page, opts.type);
  if (!(await tile.isVisible({ timeout: 5_000 }).catch(() => false))) {
    return { status: "error", message: `Studio tile for "${opts.type}" not found.` };
  }
  await tile.click();
  const dialog = page.locator(Selectors.studio.customiseDialog).first();
  if (!(await dialog.isVisible({ timeout: 6_000 }).catch(() => false))) {
    return {
      status: "error",
      message: `The "${opts.type}" customise dialog did not open — NotebookLM UI may have changed.`,
    };
  }
  const usagePercent = await readUsagePercent(page);
  let usedSources: string[] | undefined;
  try {
    // Sources first: the picker is a sub-view of the same dialog.
    if (studioOptions.sources) {
      usedSources = await selectStudioSources(page, studioOptions.sources);
    }
    if (opts.type === "report") {
      await applyReportOptions(page, studioOptions, opts.prompt);
    } else {
      await applyTypeOptions(page, opts.type, studioOptions);
      if (opts.prompt && !(await fillFocusPrompt(page, opts.prompt))) {
        log.warning(`  ⚠️  No prompt field in the "${opts.type}" dialog — prompt ignored`);
      }
    }
  } catch (err) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      usagePercent,
    };
  }
  const submitted = await submitStudioForm(page, opts.generateLater ?? false);
  if (!submitted.ok) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return { status: "error", message: submitted.message, usagePercent };
  }
  return {
    status: opts.generateLater ? "queued" : "started",
    usagePercent,
    ...(usedSources ? { sources: usedSources } : {}),
    message: opts.generateLater
      ? 'Queued via "Generate later" — outside the current limit window, ready within hours.'
      : "Generation started. Poll `list_studio_artifacts` until the item's status is `ready`.",
  };
}

/**
 * Click the element reached by a chain of (selector, index) steps, resolved
 * in DOM order inside the page. Used instead of `locator.nth()`, which
 * patchright was observed to resolve out of DOM order on NotebookLM lists.
 * Returns false when a step has no element at that index.
 */
export async function domClickPath(
  page: Page,
  rootSelector: string,
  steps: Array<{ sel: string; index: number }>
): Promise<boolean> {
  const ok = await page.evaluate(
    ({ rootSelector, steps }) => {
      let scope: Element | null = document.querySelector(rootSelector);
      for (const { sel, index } of steps) {
        if (!scope) return false;
        const all = Array.from(scope.querySelectorAll(sel));
        scope = all[index < 0 ? all.length + index : index] ?? null;
      }
      if (!(scope instanceof HTMLElement)) return false;
      scope.scrollIntoView({ block: "center" });
      scope.click();
      return true;
    },
    { rootSelector, steps }
  );
  await safeSleep(page, 200);
  return ok;
}

export interface SubmitResult {
  ok: boolean;
  message?: string;
}

/**
 * Click "Generate now" (or "Generate later") in the open Studio dialog and
 * wait for the dialog to close.
 */
export async function submitStudioForm(page: Page, later = false): Promise<SubmitResult> {
  const dialog = page.locator(Selectors.studio.customiseDialog).first();
  const candidates = later
    ? Selectors.studio.generateLaterButton
    : Selectors.studio.generateNowButton;

  for (const sel of candidates) {
    const btn = dialog.locator(sel).first();
    if (!(await btn.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) {
      const usage = await readUsagePercent(page);
      return {
        ok: false,
        message:
          `"Generate ${later ? "later" : "now"}" is disabled` +
          (usage !== null ? ` (usage meter at ${usage}%)` : "") +
          (later ? "." : ' — the limit may be reached; retry with "generate_later".'),
      };
    }
    await btn.click();
    log.info(`  ✅ Studio form submitted (${later ? "Generate later" : "Generate now"})`);
    await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
    await safeSleep(page, 500);
    return { ok: true };
  }
  return {
    ok: false,
    message: `Could not find the "Generate ${later ? "later" : "now"}" button in the Studio dialog.`,
  };
}

/** Percent of the current limit window already used, or null if no meter is shown. */
export async function readUsagePercent(page: Page): Promise<number | null> {
  const raw = await page
    .locator(Selectors.studio.usageMeter)
    .first()
    .getAttribute("aria-valuenow", { timeout: 500 })
    .catch(() => null);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Select the n-th option of the n-th `mat-button-toggle-group` in the dialog.
 * Toggle groups carry no stable labels, so position is the only
 * language-independent anchor.
 */
export async function pickToggle(
  page: Page,
  groupIndex: number,
  optionIndex: number
): Promise<boolean> {
  return domClickPath(page, Selectors.studio.customiseDialog, [
    { sel: "mat-button-toggle-group", index: groupIndex },
    { sel: "mat-button-toggle button", index: optionIndex },
  ]);
}

/** Select a format tile by the radio input's `value` attribute. */
export async function pickRadioValue(page: Page, value: string): Promise<boolean> {
  const input = page
    .locator(Selectors.studio.customiseDialog)
    .first()
    .locator(`input.mdc-radio__native-control[value="${value}"]`)
    .first();
  if ((await input.count().catch(() => 0)) === 0) return false;
  await input.check({ force: true }).catch(() => input.click({ force: true }));
  await safeSleep(page, 150);
  return true;
}

/** Fill the dialog's free-text focus / description field. */
export async function fillFocusPrompt(page: Page, prompt: string): Promise<boolean> {
  const field = page.locator(Selectors.studio.customiseDialog).first().locator("textarea").first();
  if (!(await field.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await field.fill(prompt);
  await safeSleep(page, 200);
  return true;
}
