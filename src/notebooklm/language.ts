/**
 * Output-language names and codes.
 *
 * NotebookLM lists languages by their own name ("magyar", "Deutsch",
 * "日本語"); the RPC API takes BCP-47 codes ("hu", "de", "ja"). Callers may
 * pass either, or the English name ("Hungarian"). One resolver serves the
 * dialog path and the RPC path, so a request means the same language on
 * both — a short code used to prefix-match the wrong dialog entry ("ja" →
 * "Jawa").
 *
 * Names come from the runtime's ICU data (Intl.DisplayNames), which uses the
 * same CLDR names as NotebookLM's list.
 */

/** Languages offered as NotebookLM output languages (2026-10, 80 + Default). */
// prettier-ignore
const CODES = [
  "af", "az", "ca", "ceb", "cs", "ht", "da", "de", "et", "en", "es", "es-419", "eu", "fil",
  "fr", "fr-CA", "gl", "hr", "id", "is", "it", "jv", "sw", "lv", "lt", "hu", "ms", "nl",
  "no", "uz", "pl", "pt-BR", "pt-PT", "ro", "sq", "sk", "sl", "fi", "sv", "vi", "tr", "el",
  "be", "bg", "kk", "mk", "mn", "ru", "sr", "uk", "ka", "hy", "he", "ur", "ar", "fa", "ne",
  "mr", "hi", "bn", "pa", "gu", "or", "ta", "te", "kn", "ml", "si", "th", "lo", "my", "km",
  "ko", "ja", "zh-Hans", "zh-Hant", "am", "zu", "pt", "zh", "es-ES", "es-US", "en-GB",
];

export interface ResolvedLanguage {
  /** BCP-47 code for the RPC API ("hu"). */
  code: string;
  /** The language's own name, as NotebookLM lists it ("magyar"). */
  name: string;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .toLowerCase();

let index: Map<string, ResolvedLanguage> | null = null;

function buildIndex(): Map<string, ResolvedLanguage> {
  const map = new Map<string, ResolvedLanguage>();
  const english = new Intl.DisplayNames(["en"], { type: "language" });
  for (const code of CODES) {
    let name: string;
    try {
      name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    } catch {
      continue;
    }
    const entry = { code, name };
    for (const key of [code, name, english.of(code) ?? ""]) {
      if (key && !map.has(fold(key))) map.set(fold(key), entry);
    }
  }
  return map;
}

/**
 * Resolve a code, own name or English name. Returns null for unknown input
 * and for "default"/"" (no override).
 */
export function resolveLanguage(input: string | undefined | null): ResolvedLanguage | null {
  if (!input?.trim() || fold(input) === "default") return null;
  index ??= buildIndex();
  const hit = index.get(fold(input));
  if (hit) return hit;
  // A well-formed tag outside the list ("en-AU"): trust the caller.
  try {
    const [tag] = Intl.getCanonicalLocales(input.trim());
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    return name && name !== tag ? { code: tag, name } : null;
  } catch {
    return null;
  }
}

/** Own name of a code ("hu" → "magyar"), or the code itself. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
