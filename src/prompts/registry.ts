/**
 * Prompt template registry for the MCP `prompts` capability.
 *
 * Sources (see prompts/THIRD_PARTY_NOTICES.md):
 *   - bundled `prompts/packs/browser-plugin.json` (MIT, EN + HU templates)
 *   - bundled `prompts/packs/learner-pack.json`   (MIT, slot + audience lens)
 *   - user packs: every directory in NOTEBOOKLM_PROMPT_DIRS plus each
 *     sub-directory of <dataDir>/prompt-packs (e.g. the personal prompt-styles
 *     download). Files: *.json (template arrays), *.md, *.yaml / *.yml.
 *
 * Each template renders to a single user message that tells the assistant
 * which NotebookLM tool to call with the template text.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

export type PromptTarget =
  | "ask"
  | "configure_chat"
  | "audio"
  | "video"
  | "slide_deck"
  | "mind_map"
  | "report"
  | "flashcards"
  | "quiz"
  | "infographic"
  | "data_table";

export const PROMPT_TARGETS: PromptTarget[] = [
  "ask",
  "configure_chat",
  "audio",
  "video",
  "slide_deck",
  "mind_map",
  "report",
  "flashcards",
  "quiz",
  "infographic",
  "data_table",
];

export interface PromptArgumentDef {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptTemplate {
  /** Unique MCP prompt name (lowercase, `a-z0-9-`). */
  name: string;
  pack: string;
  packName: string;
  sourceUrl: string;
  license: string;
  title: string;
  description: string;
  target: PromptTarget;
  category?: string;
  level?: string;
  attribution?: string | null;
  langs: string[];
  arguments: PromptArgumentDef[];
  /** Names of duplicate templates folded into this one (same or near-identical text). */
  aliases?: string[];
  /** Static template text per language. */
  texts?: Record<string, string>;
  /** Learner-pack slot (composed from slot + lens at render time). */
  slot?: LearnerSlot;
}

/** Shape of one entry in prompts/packs/browser-plugin.json (see the import script). */
interface BundledTemplate {
  id: string;
  format: string;
  category?: string;
  level?: string;
  attribution?: string | null;
  title: Record<string, string>;
  description: Record<string, string>;
  prompt: Record<string, string>;
}

interface LearnerSlot {
  id: string;
  title: string;
  asset: "infographic" | "deck" | "audio" | "video" | "quiz";
  body: string;
  target: PromptTarget;
}

export interface RenderArgs {
  lang?: string;
  context?: string;
  notebook?: string;
  topic?: string;
  lens?: string;
}

const FORMAT_TARGET: Record<string, PromptTarget> = {
  "text-chat": "ask",
  "configure-chat": "configure_chat",
  "audio-overview": "audio",
  "video-overview": "video",
  "slide-deck": "slide_deck",
  infographic: "infographic",
  report: "report",
  quiz: "quiz",
  flashcards: "flashcards",
  "data-table": "data_table",
  "mind-map": "mind_map",
};

const ARG_NOTEBOOK: PromptArgumentDef = {
  name: "notebook",
  description: "Notebook to use: library id or notebook URL. Omit for the active notebook.",
};
const ARG_CONTEXT: PromptArgumentDef = {
  name: "context",
  description:
    "Details used to fill the template's [BRACKETED] placeholders (topic, role, audience…).",
};

const MAX_USER_FILE_BYTES = 200_000;

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.(md|json|ya?ml)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function titleFromFile(file: string): string {
  return path
    .basename(file, path.extname(file))
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function packsDir(): string {
  // dist/prompts/registry.js → <package root>/prompts/packs
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "prompts", "packs");
}

/** Similarity at or above which two templates for the same target count as duplicates. */
const NEAR_DUPLICATE_THRESHOLD = 0.9;

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordSet(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(" ")
      .filter((w) => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export class PromptRegistry {
  private templates = new Map<string, PromptTemplate>();
  private lenses: Record<string, Record<string, string>> = {};
  private defaultLens = "operator";
  /** Dedup index: normalized primary text → kept template name, plus word sets per target. */
  private textIndex = new Map<string, string>();
  private wordIndex = new Map<string, Array<{ name: string; words: Set<string> }>>();
  private duplicates = 0;

  constructor() {
    this.loadBundled();
    this.loadUserDirs();
    log.info(
      `🧩 Prompt registry: ${this.templates.size} templates` +
        (this.duplicates ? ` (${this.duplicates} duplicates folded)` : "")
    );
  }

  list(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  lensNames(): string[] {
    return Object.keys(this.lenses);
  }

  /** Simple keyword / filter search used by `list_prompt_templates`. */
  search(opts: {
    query?: string;
    target?: string;
    pack?: string;
    lang?: string;
  }): PromptTemplate[] {
    const words = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return this.list().filter((t) => {
      if (opts.target && t.target !== opts.target) return false;
      if (opts.pack && t.pack !== opts.pack) return false;
      if (opts.lang && !t.langs.includes(opts.lang)) return false;
      if (words.length === 0) return true;
      const hay =
        `${t.name} ${t.title} ${t.description} ${t.category ?? ""} ${t.target}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  /** Template text for a language (learner slots are composed). */
  text(t: PromptTemplate, args: RenderArgs): { text: string; lang: string } {
    if (t.slot) return { text: this.composeLearner(t.slot, args), lang: "en" };
    const texts = t.texts ?? {};
    const lang =
      args.lang && texts[args.lang] ? args.lang : texts.en ? "en" : Object.keys(texts)[0];
    return { text: texts[lang] ?? "", lang };
  }

  /**
   * Render the MCP prompt message. Written as goal + context + the one
   * contract that matters (which tool receives the text), with the reason
   * beside each constraint — the assistant plans the rest itself.
   */
  render(t: PromptTemplate, args: RenderArgs): string {
    const { text, lang } = this.text(t, args);
    const nb = args.notebook?.trim();
    const notebook = nb
      ? /^https?:\/\//.test(nb)
        ? `the notebook at ${nb} (pass it as \`notebook_url\`)`
        : `the library notebook "${nb}" (pass it as \`notebook_id\`)`
      : "the active notebook; if none is selected, ask me which one to use";
    const credit = [t.packName, t.attribution ? `source: ${t.attribution}` : null, t.license]
      .filter(Boolean)
      .join(" · ");
    const context = args.context?.trim();
    const hasSlots = hasPlaceholders(text);

    const parts: string[] = [
      `I want to ${goalFor(t.target)} in NotebookLM using the prompt template "${t.title}". ` +
        `${t.description.replace(/^\[[^\]]+\]\s*/, "")}`.trim(),
      `Work on ${notebook}. ${actionFor(t.target)}`,
    ];
    if (hasSlots) {
      parts.push(
        "The template contains [BRACKETED] slots meant to be tailored to my situation; a generic " +
          "value weakens the result, so fill each one from " +
          (context ? `this context — "${context}" — and ` : "") +
          "the notebook's sources, and ask me about any slot neither of those answers. Pass the rest " +
          "of the template unchanged, since its wording is what the template author tuned."
      );
    } else if (context) {
      parts.push(`Take this context into account: "${context}".`);
    }
    if (lang !== "en") {
      parts.push(`The template is written in ${lang}; keep it in that language.`);
    }
    parts.push(`Template (${credit}):\n"""\n${text.trim()}\n"""`);
    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------

  /**
   * Register a template unless it duplicates one already loaded for the same
   * target — identical normalized text, or ≥ NEAR_DUPLICATE_THRESHOLD word
   * overlap (e.g. the same slide style shipped under two folders, or a user
   * style that copies a bundled one). Earlier packs win; the duplicate's name
   * is kept as an alias so it is still resolvable.
   */
  private add(t: PromptTemplate): void {
    let name = t.name || slug(t.title);
    for (let i = 2; this.templates.has(name); i++) name = `${t.name}-${i}`;

    const primary = t.slot
      ? `${t.slot.id} ${t.slot.body}`
      : (t.texts?.en ?? Object.values(t.texts ?? {})[0] ?? "");
    const key = `${t.target}|${normalizeText(primary)}`;
    const words = wordSet(primary);
    let keep = this.textIndex.get(key);
    if (!keep && !t.slot) {
      keep = (this.wordIndex.get(t.target) ?? []).find(
        (e) => jaccard(e.words, words) >= NEAR_DUPLICATE_THRESHOLD
      )?.name;
    }
    if (keep) {
      const kept = this.templates.get(keep);
      if (kept) {
        kept.aliases = [...(kept.aliases ?? []), name];
        // Fill languages the kept copy lacks from the duplicate.
        for (const [lang, text] of Object.entries(t.texts ?? {})) {
          if (kept.texts && !kept.texts[lang]) {
            kept.texts[lang] = text;
            kept.langs = [...new Set([...kept.langs, lang])];
          }
        }
      }
      this.duplicates++;
      return;
    }

    this.templates.set(name, { ...t, name });
    this.textIndex.set(key, name);
    const bucket = this.wordIndex.get(t.target) ?? [];
    bucket.push({ name, words });
    this.wordIndex.set(t.target, bucket);
  }

  /** Resolve a template by name or by an alias of a folded duplicate. */
  resolve(name: string): PromptTemplate | undefined {
    const direct = this.templates.get(name);
    if (direct) return direct;
    return this.list().find((t) => t.aliases?.includes(name));
  }

  private loadBundled(): void {
    const dir = packsDir();
    try {
      const bp = JSON.parse(fs.readFileSync(path.join(dir, "browser-plugin.json"), "utf8"));
      for (const tpl of bp.templates as BundledTemplate[]) {
        const target = FORMAT_TARGET[tpl.format];
        if (!target) continue;
        const langs = Object.keys(tpl.prompt).filter((l) => tpl.prompt[l]);
        this.add({
          name: `pa-${slug(tpl.id)}`,
          pack: "browser-plugin",
          packName: bp.pack.name,
          sourceUrl: bp.pack.repo,
          license: bp.pack.license,
          title: tpl.title.en ?? tpl.title.hu,
          description: `[${target}] ${tpl.description.en ?? tpl.description.hu ?? ""}`.trim(),
          target,
          category: tpl.category,
          level: tpl.level,
          attribution: tpl.attribution,
          langs,
          texts: tpl.prompt,
          arguments: [
            ARG_CONTEXT,
            { name: "lang", description: `Template language: ${langs.join(" | ")} (default en).` },
            ARG_NOTEBOOK,
          ],
        });
      }
    } catch (e) {
      log.warning(`⚠️  browser-plugin prompt pack not loaded: ${e}`);
    }

    try {
      const lp = JSON.parse(fs.readFileSync(path.join(dir, "learner-pack.json"), "utf8"));
      this.lenses = lp.lenses ?? {};
      this.defaultLens = lp.pack.defaultLens ?? "operator";
      for (const slot of lp.slots as LearnerSlot[]) {
        this.add({
          name: `learner-${slot.id.toLowerCase()}-${slug(slot.title)}`,
          pack: "learner-pack",
          packName: lp.pack.name,
          sourceUrl: lp.pack.repo,
          license: lp.pack.license,
          title: `${slot.id} ${slot.title}`,
          description: `[${slot.target}] Learner Pack ${slot.id}: ${firstLine(slot.body)}`,
          target: slot.target,
          category: "learning",
          langs: ["en"],
          slot,
          arguments: [
            {
              name: "topic",
              description: "Topic of the asset (e.g. the policy, product or subject).",
              required: true,
            },
            {
              name: "lens",
              description: `Audience lens: ${Object.keys(this.lenses).join(" | ")} (default ${this.defaultLens}).`,
            },
            ARG_CONTEXT,
            ARG_NOTEBOOK,
          ],
        });
      }
    } catch (e) {
      log.warning(`⚠️  learner-pack prompt pack not loaded: ${e}`);
    }
  }

  private loadUserDirs(): void {
    const dirs = (process.env.NOTEBOOKLM_PROMPT_DIRS ?? "")
      .split(path.delimiter)
      .map((d) => d.trim())
      .filter(Boolean);
    const userPacks = path.join(CONFIG.dataDir, "prompt-packs");
    if (fs.existsSync(userPacks)) {
      for (const d of fs.readdirSync(userPacks, { withFileTypes: true })) {
        if (d.isDirectory()) dirs.push(path.join(userPacks, d.name));
      }
    }
    for (const dir of dirs) {
      try {
        this.loadUserDir(dir);
      } catch (e) {
        log.warning(`⚠️  Prompt dir ${dir} skipped: ${e}`);
      }
    }
  }

  private loadUserDir(dir: string): void {
    const metaFile = path.join(dir, "pack.json");
    const meta: Record<string, string> = fs.existsSync(metaFile)
      ? JSON.parse(fs.readFileSync(metaFile, "utf8"))
      : {};
    const packId = slug(meta.id ?? path.basename(dir));
    const packName = meta.name ?? path.basename(dir);
    const defaultTarget = (meta.target as PromptTarget) ?? undefined;
    const base = {
      pack: packId,
      packName,
      sourceUrl: meta.repo ?? dir,
      license: meta.license ?? "user-provided",
    };

    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (file === "pack.json" || !fs.statSync(full).isFile()) continue;
      if (fs.statSync(full).size > MAX_USER_FILE_BYTES) continue;
      const ext = path.extname(file).toLowerCase();
      const content = fs.readFileSync(full, "utf8");

      if (ext === ".json") {
        const arr = JSON.parse(content);
        for (const tpl of Array.isArray(arr) ? arr : []) {
          const target = asTarget(
            tpl.target ?? FORMAT_TARGET[tpl.format] ?? defaultTarget ?? "ask"
          );
          const texts: Record<string, string> =
            typeof tpl.prompt === "string"
              ? { [tpl.lang ?? "en"]: tpl.prompt }
              : (tpl.prompt ?? {});
          if (!target || Object.keys(texts).length === 0) continue;
          this.add({
            ...base,
            name: `${packId}-${slug(tpl.id ?? tpl.title)}`,
            title: tpl.title ?? tpl.id,
            description: `[${target}] ${tpl.description ?? ""}`.trim(),
            target,
            langs: Object.keys(texts),
            texts,
            arguments: [ARG_CONTEXT, ARG_NOTEBOOK],
          });
        }
      } else if (ext === ".md" || ext === ".yaml" || ext === ".yml") {
        const fm = content.match(/^---\n([\s\S]*?)\n---\n?/);
        const fmTarget = fm?.[1].match(/^target:\s*(\S+)/m)?.[1];
        const target = asTarget(
          fmTarget ?? defaultTarget ?? (ext === ".md" ? "ask" : "slide_deck")
        );
        if (!target) continue;
        const body = fm ? content.slice(fm[0].length) : content;
        const heading = ext === ".md" ? body.match(/^#\s+(.+)$/m)?.[1] : undefined;
        const yamlDesc =
          ext !== ".md" ? content.match(/^\s*description:\s*"?(.+?)"?\s*$/m)?.[1] : undefined;
        this.add({
          ...base,
          name: `${packId}-${slug(file)}`,
          title: heading ?? titleFromFile(file),
          description: `[${target}] ${yamlDesc ?? heading ?? titleFromFile(file)}`.slice(0, 300),
          target,
          langs: ["en"],
          texts: { en: body.trim() },
          arguments: [ARG_CONTEXT, ARG_NOTEBOOK],
        });
      }
    }
  }

  private composeLearner(slot: LearnerSlot, args: RenderArgs): string {
    const lensKey = args.lens && this.lenses[args.lens] ? args.lens : this.defaultLens;
    const lens = this.lenses[lensKey] ?? {};
    const lensText =
      lens[slot.asset === "infographic" ? "general" : slot.asset] ?? lens.general ?? "";
    const topic = args.topic?.trim() || "[TOPIC]";
    const body = slot.body
      .replace(/\*\*NotebookLM target:\*\*.*$/m, "")
      .replace(/\*\*/g, "")
      .trim();
    return [
      `${slot.title} — topic: ${topic}.`,
      body,
      lensText ? `Audience (${lensKey}): ${lensText}` : "",
      "Build every element from the notebook's sources — the actual entities, numbers and " +
        "thresholds they name — so the result is specific to this topic; where the sources are " +
        "silent, stay general rather than filling the gap.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

/**
 * Inline `[SLOT]` tokens are placeholders; a bracketed token alone on its line
 * (`[CONTEXT]`, `[OBJECTIVE]`) is a section header of a structured prompt.
 */
function hasPlaceholders(text: string): boolean {
  const token = /\[[^\]\n]{2,60}\]/g;
  return text
    .split("\n")
    .some((line) => token.test(line) && line.replace(token, "").trim().length > 0);
}

function asTarget(v: string): PromptTarget | undefined {
  return (PROMPT_TARGETS as string[]).includes(v) ? (v as PromptTarget) : undefined;
}

function firstLine(s: string): string {
  return s.replace(/\*\*/g, "").split("\n")[0].slice(0, 160);
}

const TARGET_LABEL: Record<PromptTarget, string> = {
  ask: "get a grounded answer from my sources",
  configure_chat: "set the notebook's chat system instruction",
  audio: "create an Audio Overview",
  video: "create a Video Overview",
  slide_deck: "create a slide deck",
  mind_map: "create a mind map",
  report: "create a report",
  flashcards: "create flashcards",
  quiz: "create a quiz",
  infographic: "create an infographic",
  data_table: "create a data table",
};

function goalFor(target: PromptTarget): string {
  return TARGET_LABEL[target];
}

/** Every generation can be limited to chosen sources — the main accuracy lever. */
const SCOPE =
  "Pass `sources` with the sources this output should use — the vetted ones about its topic; " +
  "that is the strongest lever on accuracy. ";

/** The tool contract for each target, with the reason where the choice is not obvious. */
function actionFor(target: PromptTarget): string {
  switch (target) {
    case "ask":
      return (
        "Send the template as the `question` of `ask_question`, with `sources` set to the " +
        "sources the question is about when the notebook holds more than that."
      );
    case "configure_chat":
      return (
        "The template becomes the `custom_prompt` of `configure_chat`. That setting persists and " +
        "shapes every later answer in this notebook, so show me the current configuration " +
        "(`configure_chat` without arguments) and get my go-ahead before replacing it."
      );
    case "audio":
      return (
        "Send the template as the `custom_prompt` of `generate_audio`. " +
        SCOPE +
        "Format and length keep NotebookLM's defaults unless I ask for something specific."
      );
    case "report":
      return (
        "Send the template as the `prompt` of `generate_studio_artifact` with " +
        '`type: "report"` and `template: "create_your_own"`. ' +
        SCOPE +
        "Language keeps the account's setting unless I ask for another."
      );
    default:
      return (
        `Send the template as the \`prompt\` of \`generate_studio_artifact\` with \`type: "${target}"\`. ` +
        SCOPE +
        "Its other options (language, format …) keep NotebookLM's defaults unless I ask for " +
        "something specific."
      );
  }
}
