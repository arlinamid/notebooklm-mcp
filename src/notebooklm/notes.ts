/**
 * Notes (2026-09 UI): chat answers can be pinned as notes ("Save to note",
 * `keep_pin` glyph); notes live in the Studio library as
 * `<artifact-library-note>` and can be turned into sources ("Convert to
 * source", `convert_to_text` glyph; "Convert all notes to source",
 * `docs_add_on` glyph). That lets a worked-out answer become a source that
 * later questions and Studio outputs can build on.
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { countSources, waitForSourceCountIncrease } from "./sources.js";
import { waitForChatHistory } from "./chat.js";
import { safeSleep } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

export interface SavedNote {
  title: string;
  /** First characters of the note body, to confirm the right answer was saved. */
  preview: string;
  /** The question whose answer was saved. */
  question: string;
  /** Start of that answer as shown in the chat (matches `preview`). */
  answerStart: string;
}

/** Close an open note editor so the Studio library / tiles are reachable. */
export async function ensureStudioListView(page: Page): Promise<void> {
  if (
    !(await page
      .locator(Selectors.notes.editor)
      .first()
      .isVisible()
      .catch(() => false))
  )
    return;
  const close = page.locator(Selectors.notes.closeEditor).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page
      .locator(Selectors.notes.editor)
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => undefined);
    await safeSleep(page, 300);
  }
}

/**
 * Save a chat answer as a note. Targets the answer to `question` (last
 * matching turn; exact text first, then substring), or the latest answer.
 */
export async function saveAnswerAsNote(page: Page, question?: string): Promise<SavedNote> {
  await waitForChatHistory(page);

  // Select the turn and click its button in ONE page-side pass over the DOM.
  // Patchright's `locator.nth(i)` was observed to resolve chat turns out of
  // DOM order (nth(0) → 3rd turn …), which saved the wrong answer; and a
  // coordinate-based click could hit a neighbouring turn's button.
  const pick = await page.evaluate(
    ({ pairSel, questionSel, wanted, glyph, aria }) => {
      const pairs = Array.from(document.querySelectorAll(pairSel));
      const questions = pairs.map((p) =>
        (p.querySelector(questionSel)?.textContent ?? "").replace(/\s+/g, " ").trim()
      );
      if (pairs.length === 0) return { error: "empty" as const, questions };
      let idx = pairs.length - 1;
      if (wanted) {
        const q = wanted.replace(/\s+/g, " ").trim().toLowerCase();
        idx = questions.map((t) => t.toLowerCase() === q).lastIndexOf(true);
        if (idx === -1) idx = questions.map((t) => t.toLowerCase().includes(q)).lastIndexOf(true);
        if (idx === -1) return { error: "nomatch" as const, questions };
      }
      const pair = pairs[idx];
      const btn = Array.from(pair.querySelectorAll<HTMLElement>(".to-user-container button")).find(
        (b) =>
          b.getBoundingClientRect().width > 0 &&
          (b.querySelector("mat-icon")?.textContent?.trim() === glyph ||
            b.getAttribute("aria-label") === aria)
      );
      if (!btn) return { error: "nobutton" as const, questions, idx };
      const expected = (pair.querySelector(".to-user-container .paragraph")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { questions, idx, expected };
    },
    {
      pairSel: Selectors.notes.chatPair,
      questionSel: Selectors.notes.pairQuestion,
      wanted: question ?? null,
      glyph: "keep_pin",
      aria: "Save message to a note",
    }
  );

  if ("error" in pick) {
    if (pick.error === "empty") throw new Error("This notebook has no chat answers to save yet.");
    if (pick.error === "nomatch") {
      throw new Error(
        `No chat turn matches "${question}". Recent questions: ` +
          pick.questions
            .slice(-5)
            .map((t) => `"${t.slice(0, 60)}"`)
            .join(", ")
      );
    }
    throw new Error(`The answer to "${pick.questions[pick.idx]}" has no "Save to note" button.`);
  }
  const { questions, idx, expected } = pick;

  const editor = page.locator(Selectors.notes.editor).first();
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await safeSleep(page, 800);
  const title = (
    await editor
      .locator(Selectors.notes.editorTitle)
      .first()
      .inputValue()
      .catch(() => "")
  ).trim();
  const preview = (
    (await editor
      .locator(Selectors.notes.editorBody)
      .first()
      .innerText()
      .catch(() => "")) || ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  await ensureStudioListView(page);

  // Guard against saving the wrong turn: the note must start like the answer.
  const probe = expected.slice(0, 25).toLowerCase();
  if (!probe || !preview.toLowerCase().startsWith(probe)) {
    throw new Error(
      `Saved note "${title}" does not match the answer to "${questions[idx]}" ` +
        `(note starts "${preview.slice(0, 60)}…"). Delete it in the UI and retry.`
    );
  }
  log.success(`  ✅ Saved answer as note "${title}"`);
  return { title, preview, question: questions[idx], answerStart: expected.slice(0, 80) };
}

export interface ConvertResult {
  converted: string;
  sourceCountBefore: number;
  sourceCountAfter: number;
}

/**
 * Turn a note (matched by title: exact, then unique substring) — or all
 * notes — into source(s).
 */
export async function convertNoteToSource(
  page: Page,
  opts: { title?: string; all?: boolean }
): Promise<ConvertResult> {
  await ensureStudioListView(page);
  const notes = page.locator(Selectors.notes.libraryNote);
  const titles = await notes.evaluateAll((els) =>
    els.map((e) => (e.querySelector(".artifact-title")?.textContent ?? "").trim())
  );
  if (titles.length === 0) throw new Error("This notebook has no notes.");

  let idx = 0;
  if (!opts.all) {
    if (!opts.title) throw new Error("Give `note_title`, or `all: true` to convert every note.");
    const q = opts.title.trim().toLowerCase();
    idx = titles.findIndex((t) => t.toLowerCase() === q);
    if (idx === -1) {
      const hits = titles
        .map((t, i) => (t.toLowerCase().includes(q) ? i : -1))
        .filter((i) => i >= 0);
      if (hits.length !== 1) {
        throw new Error(
          `Note "${opts.title}" ${hits.length ? "is ambiguous" : "not found"}. Notes: ` +
            titles.map((t) => `"${t}"`).join(", ")
        );
      }
      idx = hits[0];
    }
  }

  const before = await countSources(page);
  // DOM-order click on that note's "More" button (no `locator.nth`, see above).
  const opened = await page.evaluate(
    ({ noteSel, i }) => {
      const note = document.querySelectorAll(noteSel)[i];
      const btn = Array.from(note?.querySelectorAll<HTMLElement>("button") ?? []).find(
        (b) => b.querySelector("mat-icon")?.textContent?.trim() === "more_vert"
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    { noteSel: Selectors.notes.libraryNote, i: idx }
  );
  if (!opened) throw new Error(`Could not open the menu of note "${titles[idx]}".`);
  const item = page
    .locator(opts.all ? Selectors.notes.convertAllMenuItem : Selectors.notes.convertMenuItem)
    .first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();

  const after = await waitForSourceCountIncrease(page, before, 60_000);
  if (after <= before) {
    throw new Error("Conversion was triggered but no new source appeared within 60 s.");
  }
  return {
    converted: opts.all ? `all notes (${titles.length})` : titles[idx],
    sourceCountBefore: before,
    sourceCountAfter: after,
  };
}
