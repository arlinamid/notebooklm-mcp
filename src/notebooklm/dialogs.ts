/**
 * Dismissal of announcement / promo modals.
 *
 * Since the 2026-09 "Gemini Notebook" rebrand, the notebook page opens a
 * modal `<mat-dialog-container role="dialog">` hosting e.g.
 * `<accessibility-promo-dialog>` ("We're giving you more flexibility…").
 * It blocks every click behind it, and because it is a `[role="dialog"]` the
 * add-source flow would mistake it for the Add-source modal.
 *
 * We only close dialogs whose Angular component host tag looks like an
 * announcement, so a genuine Add-source / customise dialog is never touched.
 */

import type { Page } from "patchright";
import { log } from "../utils/logger.js";

const PROMO_HOST_PATTERN = /promo|announcement|onboarding|whats-?new|welcome|tutorial|tour/i;
const MARK_ATTR = "data-mcp-promo-dialog";

/**
 * Close every visible announcement modal. Safe to call at any time; returns
 * the number of dialogs closed.
 */
export async function dismissPromoDialogs(page: Page): Promise<number> {
  let closed = 0;
  for (let round = 0; round < 3; round++) {
    const hostTag = await page
      .evaluate(
        ({ pattern, attr }) => {
          const re = new RegExp(pattern, "i");
          for (const dlg of Array.from(document.querySelectorAll('[role="dialog"]'))) {
            const rect = dlg.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const host = dlg.querySelector(".mat-mdc-dialog-component-host");
            const tag = host?.tagName.toLowerCase() ?? "";
            if (tag && re.test(tag)) {
              dlg.setAttribute(attr, "1");
              return tag;
            }
          }
          return null;
        },
        { pattern: PROMO_HOST_PATTERN.source, attr: MARK_ATTR }
      )
      .catch(() => null);
    if (!hostTag) break;

    const dialog = page.locator(`[${MARK_ATTR}]`).first();
    const closeBtn = dialog
      .locator(
        'button.close-button, button[aria-label="Close dialog"], button:has(mat-icon:text-is("close"))'
      )
      .first();
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click({ timeout: 3_000 }).catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await dialog.waitFor({ state: "detached", timeout: 3_000 }).catch(() => undefined);
    log.info(`  🧹 Dismissed announcement dialog <${hostTag}>`);
    closed++;
  }
  return closed;
}
