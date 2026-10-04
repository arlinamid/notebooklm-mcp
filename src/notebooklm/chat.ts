/**
 * NotebookLM chat extraction with streaming-stability detection.
 *
 * Replaces the legacy `waitForLatestAnswer()` (issue #43). Old logic gated on
 * `div.thinking-message`, which Google removed; calls timed out even though
 * the answer was visible. New logic only relies on the answer container itself
 * and treats text as final once it has been *stable* across N consecutive
 * polls (default 3). That makes the wait robust to UI churn and Material-icon
 * leaks (`more_vert`, `more_horiz`, …) which would otherwise destabilise the
 * extracted text.
 *
 * Companion fixes:
 * - issue #14 / #27 — timeout is fully configurable per call
 * - issue #16    — bounded polls + sleep fallback to defuse zombie pages
 * - issue #28    — sanitisation strips UI-control labels before delivery
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { isRecoverable, pageIsAlive, safeSleep } from "../browser/watchdog.js";

/**
 * Loading-state phrases NotebookLM streams into the answer container before
 * the real response arrives. The stability detector would otherwise lock
 * onto these (they're "stable" while Gemini still thinks). Coverage spans
 * the eight major NotebookLM locales (EN, DE, FR, ES, PT, IT, NL, JA).
 */
const PLACEHOLDER_SNIPPETS = [
  // English
  "answer is being created",
  "answer is being generated",
  "creating answer",
  "generating answer",
  "getting the context",
  "getting the gist",
  "loading",
  "please wait",
  "looking for clues",
  "reading full chapters",
  "examining the specifics",
  "checking the scope",
  "opening your notes",
  "analyzing your files",
  "searching your docs",
  "scanning sources",
  "reviewing content",
  "processing request",
  "parsing the data",
  "gathering the facts",
  "thinking",
  "searching",
  // German
  "antwort wird erstellt",
  "antwort wird generiert",
  "wird erstellt",
  "wird generiert",
  "lädt",
  "wird geladen",
  "bitte warten",
  "quellen werden gescannt",
  "kontext wird abgerufen",
  "denke nach",
  // French
  "analyse en cours",
  "génération en cours",
  "réponse en cours",
  "chargement en cours",
  "veuillez patienter",
  "recherche en cours",
  // Spanish
  "generando respuesta",
  "creando respuesta",
  "cargando",
  "espere por favor",
  "buscando",
  "analizando",
  // Italian
  "generazione della risposta",
  "creazione della risposta",
  "caricamento",
  "attendere",
  "ricerca in corso",
  "analisi in corso",
  // Portuguese
  "gerando resposta",
  "criando resposta",
  "carregando",
  "por favor aguarde",
  "procurando",
  "analisando",
  // Dutch
  "antwoord wordt gegenereerd",
  "antwoord wordt gemaakt",
  "laden",
  "even geduld",
  "zoeken",
  "analyseren",
  // Japanese
  "回答を生成しています",
  "読み込み中",
  "お待ちください",
  "検索中",
  "分析中",
];

const ERROR_SNIPPETS = [
  // English
  "the system could not respond",
  "the system failed",
  "an error occurred",
  "try again later",
  // German
  "das system konnte keine antwort erstellen",
  "das system konnte nicht antworten",
  "es ist ein fehler aufgetreten",
  "versuche es später erneut",
  "versuchen sie es später erneut",
  // French
  "le système n'a pas pu répondre",
  "le système n'a pas réussi",
  "une erreur est survenue",
  "réessayez plus tard",
  // Spanish
  "el sistema no pudo responder",
  "ha ocurrido un error",
  "vuelve a intentarlo más tarde",
  "inténtalo de nuevo más tarde",
  // Italian
  "il sistema non è riuscito a rispondere",
  "si è verificato un errore",
  "riprova più tardi",
  // Portuguese
  "o sistema não pôde responder",
  "ocorreu um erro",
  "tente novamente mais tarde",
  // Dutch
  "het systeem kon niet reageren",
  "er is een fout opgetreden",
  "probeer het later opnieuw",
  // Japanese
  "システムが応答できませんでした",
  "エラーが発生しました",
  "後でもう一度お試しください",
];

const RATE_LIMIT_MESSAGES = [
  // English
  "daily discussion limit",
  "daily limit reached",
  "query limit reached",
  "rate limit exceeded",
  "usage limit reached",
  "reached your usage limit",
  // German
  "tägliches diskussionslimit",
  "tageslimit erreicht",
  "ratenlimit überschritten",
  // French
  "vous avez atteint la limite quotidienne",
  "limite quotidienne de discussions",
  "limite quotidienne atteinte",
  // Spanish
  "límite diario alcanzado",
  "has alcanzado el límite diario",
  // Italian
  "limite giornaliero raggiunto",
  "hai raggiunto il limite giornaliero",
  // Portuguese
  "limite diário atingido",
  "você atingiu o limite diário",
  // Dutch
  "daglimiet bereikt",
  // Japanese
  "1日あたりの上限に達しました",
];

function isPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
  // Loading indicators are short status lines. Without the length cap any
  // real answer that merely *contains* "loading", "searching", "thinking" …
  // was treated as a placeholder forever and the call timed out.
  if (text.length < 120 && PLACEHOLDER_SNIPPETS.some((s) => lower.includes(s))) return true;
  // Short text ending with "..." is almost certainly a loading indicator;
  // real responses run well past 50 chars.
  if (text.length < 50 && text.trim().endsWith("...")) return true;
  return false;
}

function isErrorMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return ERROR_SNIPPETS.some((s) => lower.includes(s));
}

function isRateLimitText(text: string): boolean {
  const lower = text.toLowerCase();
  return RATE_LIMIT_MESSAGES.some((s) => lower.includes(s));
}

export interface AskOptions {
  /** The question text — used to skip echo lines that NotebookLM mirrors back. */
  question?: string;
  /** Hard ceiling on the wait. Default 600 000 ms (10 min) — overridable per call. */
  timeoutMs?: number;
  /** Poll cadence. Default 750 ms. Lower values increase load without much benefit. */
  pollIntervalMs?: number;
  /** Texts known *before* the question was submitted. Used to skip prior answers. */
  ignoreTexts?: string[];
  /** How many consecutive identical polls count as "answer settled". Default 3. */
  stablePolls?: number;
}

/**
 * Snapshot every visible assistant answer text *before* a new question is
 * submitted. Pass the result into `waitForStableAnswer({ ignoreTexts })` so
 * the new turn isn't confused with prior turns in the same session.
 */
export async function snapshotPriorAnswers(page: Page): Promise<string[]> {
  await waitForChatHistory(page);
  const texts = await readAnswerTexts(page).catch(() => []);
  return texts.map(sanitizeAnswer).filter(Boolean);
}

/**
 * Wait until the chat history has finished rendering. Right after the
 * notebook page loads the history is not in the DOM yet (0 turns) and then
 * streams in; acting before it settles saved the wrong answer as a note and
 * could let an old answer look "new" to the stability detector. Settled =
 * the turn count is unchanged for `stableMs` (an empty chat settles at 0).
 */
export async function waitForChatHistory(
  page: Page,
  { stableMs = 1_500, timeoutMs = 12_000 }: { stableMs?: number; timeoutMs?: number } = {}
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const n = await page
      .locator(Selectors.chat.turn)
      .count()
      .catch(() => 0);
    if (n !== last) {
      last = n;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return n;
    }
    await safeSleep(page, 300);
  }
  return Math.max(last, 0);
}

/**
 * innerText of every answer bubble, minus the collapsible reasoning block.
 *
 * Since the 2026-09 UI, each answer starts with a `<thinking-chain-view>`
 * ("Thoughts" + `expand_more`, plus streamed reasoning steps while the model
 * works). It is not part of the answer, and while it streams it can look
 * "stable" long enough to be returned as the final answer — so strip it and
 * report an empty string until real answer content shows up.
 */
async function readAnswerTexts(page: Page): Promise<string[]> {
  return page.locator(Selectors.chat.answerText).evaluateAll(
    (nodes, { thinkingSel, markerSel }) => {
      // Citation markers (`button.citation-marker`) render as separate lines
      // in innerText ("father\n1\n2\n."). Swap each for an inline "[N]" — the
      // form `formatAnswer` expects — and hide the reasoning block, read
      // innerText, then restore. All synchronous, so nothing is ever painted.
      return nodes.map((node) => {
        const el = node as HTMLElement;
        const hidden: Array<[HTMLElement, string]> = [];
        const inserted: Text[] = [];
        const hide = (h: HTMLElement) => {
          hidden.push([h, h.style.display]);
          h.style.display = "none";
        };
        try {
          el.querySelectorAll<HTMLElement>(thinkingSel).forEach(hide);
          el.querySelectorAll<HTMLElement>(markerSel).forEach((m) => {
            const num = (m.textContent ?? "").trim();
            if (/^\d+$/.test(num)) {
              const t = document.createTextNode(`[${num}]`);
              m.parentNode?.insertBefore(t, m);
              inserted.push(t);
            }
            hide(m);
          });
          return (el.innerText ?? "").trim();
        } finally {
          inserted.forEach((t) => t.remove());
          hidden.forEach(([h, display]) => (h.style.display = display));
        }
      });
    },
    { thinkingSel: Selectors.chat.thinkingBlock, markerSel: Selectors.citations.button.join(", ") }
  );
}

/**
 * Wait for the *latest* answer text to appear and stabilise.
 *
 * Returns the sanitised final text, or `null` on timeout. The function never
 * throws on UI hiccups — failure surfaces as `null` so the caller can decide
 * how to recover (retry vs. report error to the user).
 */
export async function waitForStableAnswer(
  page: Page,
  options: AskOptions = {}
): Promise<string | null> {
  const {
    question = "",
    timeoutMs = 600_000,
    pollIntervalMs = 750,
    ignoreTexts = [],
    stablePolls = 3,
  } = options;

  const deadline = Date.now() + timeoutMs;
  const echoLower = question.trim().toLowerCase();
  const ignoreSet = new Set(ignoreTexts.map((t) => t.trim()).filter(Boolean));
  // Hard ceiling on poll iterations defends against pathological
  // pollIntervalMs values combined with zombie-page sleep returns (issue #16).
  const maxPolls = Math.max(8, Math.ceil(timeoutMs / Math.max(50, pollIntervalMs)) + 4);

  let lastSeen: string | null = null;
  let stableStreak = 0;
  let pollCount = 0;

  while (Date.now() < deadline && pollCount < maxPolls) {
    pollCount++;

    // Every 10th poll we make sure the renderer still answers — bounded so a
    // wedged tab can't keep us spinning until the deadline (issue #16).
    if (pollCount % 10 === 0 && !(await pageIsAlive(page))) {
      throw new Error("Browser page unresponsive: health check timed out");
    }

    let candidate: string | null = null;
    try {
      candidate = await readLatestAnswer(page);
    } catch (err) {
      if (isRecoverable(err)) throw err;
      // Non-fatal extraction blip — try again next tick.
    }

    if (candidate) {
      const isEcho = candidate.toLowerCase() === echoLower;
      const isPrior = ignoreSet.has(candidate);

      if (!isEcho && !isPrior) {
        // Loading placeholders ("Parsing the data…", "Thinking…", …) are
        // stable while Gemini is still working — the old code locked on to
        // them and returned them as the final answer. Filter them out.
        if (isPlaceholder(candidate)) {
          stableStreak = 0;
          lastSeen = null;
          await safeSleep(page, Math.min(pollIntervalMs, 400));
          continue;
        }

        // Hard errors and rate-limit messages can be returned immediately —
        // there is no "stable" follow-up text coming.
        if (isErrorMessage(candidate) || isRateLimitText(candidate)) {
          return candidate;
        }

        if (candidate === lastSeen) {
          stableStreak++;
          if (stableStreak >= stablePolls) {
            return candidate;
          }
        } else {
          lastSeen = candidate;
          stableStreak = 1;
        }
      }
    }

    await safeSleep(page, pollIntervalMs);
  }

  return null;
}

/**
 * Read the latest answer container's text and strip UI-control leakage.
 * Uses the last answer bubble so we always target the most recent turn.
 */
async function readLatestAnswer(page: Page): Promise<string | null> {
  try {
    const texts = await readAnswerTexts(page);
    const raw = texts[texts.length - 1];
    if (!raw) return null;
    const cleaned = sanitizeAnswer(raw);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

/**
 * Strip Material-icon labels (`more_vert`, `more_horiz`, …) and orphaned
 * citation markers that NotebookLM occasionally leaks into `innerText`.
 * Only isolated lines are removed — never inline content — so legitimate
 * answer prose with the same words ("more horizontal") is not touched.
 */
export function sanitizeAnswer(text: string): string {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (Selectors.uiControlLabels.has(line)) continue;

    // Drop lone digits or punctuation flanking a UI-control label
    // (typical citation-marker leak: ["1", "more_vert"]).
    const next = lines[i + 1] ?? "";
    const prev = lines[i - 1] ?? "";
    const nextIsControl = Selectors.uiControlLabels.has(next);
    const prevIsControl = Selectors.uiControlLabels.has(prev);
    if (/^\d+$/.test(line) && nextIsControl) continue;
    // Punctuation split off by a citation marker ("…predator", "1",
    // "more_horiz", ".") belongs to the preceding sentence — re-attach it.
    if (/^[.,;:!?]+$/.test(line) && (nextIsControl || prevIsControl)) {
      if (kept.length > 0) kept[kept.length - 1] += line;
      continue;
    }

    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/(\S)\[(\d+)\]/g, "$1 [$2]")
    .trim();
}
