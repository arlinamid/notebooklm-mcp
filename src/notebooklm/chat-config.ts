/**
 * Notebook menu → "Configure Chat" (2026-09 UI, `<configure-notebook-settings>`).
 *
 * Two toggle groups, located by position because they carry no stable
 * labels:
 *   group 0 — conversational goal: Default | Learning Guide | Custom
 *             (Custom reveals a free-text field, max 10 000 chars)
 *   group 1 — response length:     Default | Longer | Shorter
 * The "Save" button is `button.submit-button`.
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { safeSleep } from "../browser/watchdog.js";
import { domClickPath } from "./studio.js";

export type ChatGoal = "default" | "learning_guide" | "custom";
export type ChatLength = "default" | "longer" | "shorter";

const GOALS: ChatGoal[] = ["default", "learning_guide", "custom"];
const LENGTHS: ChatLength[] = ["default", "longer", "shorter"];

export interface ChatConfigInput {
  goal?: ChatGoal;
  /** Instructions for `goal: "custom"` (style, role, tone…). */
  customPrompt?: string;
  length?: ChatLength;
}

export interface ChatConfigResult {
  goal: ChatGoal | "unknown";
  length: ChatLength | "unknown";
  customPrompt: string | null;
  /** True when changes were saved; false for a pure read or when nothing changed. */
  saved: boolean;
}

export async function configureChat(page: Page, input: ChatConfigInput): Promise<ChatConfigResult> {
  await clickVisible(page, Selectors.settings.notebookMenuButton, "notebook menu button");
  await clickVisible(page, Selectors.settings.configureChatMenuItem, '"Configure Chat" menu item');
  const dialog = page.locator(Selectors.settings.configureChatDialog).first();
  await dialog.waitFor({ state: "visible", timeout: 8_000 });
  await safeSleep(page, 400);

  const pick = async (groupIdx: number, optionIdx: number) => {
    const ok = await domClickPath(page, Selectors.settings.configureChatDialog, [
      { sel: "mat-button-toggle-group", index: groupIdx },
      { sel: "mat-button-toggle button", index: optionIdx },
    ]);
    if (!ok) throw new Error("Configure Chat option not found — NotebookLM UI may have changed.");
    await safeSleep(page, 250);
  };

  try {
    if (input.goal) await pick(0, GOALS.indexOf(input.goal));
    if (input.customPrompt !== undefined) {
      if (input.goal && input.goal !== "custom") {
        throw new Error('`custom_prompt` only applies with goal "custom".');
      }
      if (!input.goal) await pick(0, GOALS.indexOf("custom"));
      const field = dialog.locator("textarea").first();
      await field.waitFor({ state: "visible", timeout: 3_000 });
      await field.fill(input.customPrompt);
    }
    if (input.length) await pick(1, LENGTHS.indexOf(input.length));

    const state = await readState(page);

    let saved = false;
    const wantsChange = !!(input.goal || input.length || input.customPrompt !== undefined);
    const save = dialog.locator("button.submit-button").first();
    if (wantsChange && !(await save.isDisabled().catch(() => true))) {
      await save.click();
      await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
      saved = true;
    }
    return { ...state, saved };
  } finally {
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
}

async function readState(page: Page): Promise<Omit<ChatConfigResult, "saved">> {
  return page
    .locator(Selectors.settings.configureChatDialog)
    .first()
    .evaluate(
      (root, { goals, lengths }) => {
        const groups = Array.from(root.querySelectorAll("mat-button-toggle-group"));
        const checkedIdx = (g: Element | undefined) =>
          g
            ? Array.from(g.querySelectorAll("mat-button-toggle")).findIndex((t) =>
                t.classList.contains("mat-button-toggle-checked")
              )
            : -1;
        const gi = checkedIdx(groups[0]);
        const li = checkedIdx(groups[1]);
        const ta = root.querySelector("textarea") as HTMLTextAreaElement | null;
        return {
          goal: (goals[gi] ?? "unknown") as ChatGoal | "unknown",
          length: (lengths[li] ?? "unknown") as ChatLength | "unknown",
          customPrompt: ta ? ta.value : null,
        };
      },
      { goals: GOALS, lengths: LENGTHS }
    );
}

async function clickVisible(
  page: Page,
  selectors: readonly string[],
  label: string
): Promise<void> {
  await page
    .locator(selectors.join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click();
      await safeSleep(page, 300);
      return;
    }
  }
  throw new Error(`Could not find the ${label} — NotebookLM UI may have changed.`);
}
