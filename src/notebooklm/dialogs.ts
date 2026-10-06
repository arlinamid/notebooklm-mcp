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
    const token = `${Date.now()}-${round}`;
    const hostTag = await page
      .evaluate(
        ({ pattern, attr, token }) => {
          const re = new RegExp(pattern, "i");
          for (const dlg of Array.from(document.querySelectorAll('[role="dialog"]'))) {
            // Marked earlier and could not be closed — already being ignored.
            if (dlg.hasAttribute(attr)) continue;
            const rect = dlg.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const host = dlg.querySelector(".mat-mdc-dialog-component-host");
            const tag = host?.tagName.toLowerCase() ?? "";
            if (tag && re.test(tag)) {
              dlg.setAttribute(attr, token);
              return tag;
            }
          }
          return null;
        },
        { pattern: PROMO_HOST_PATTERN.source, attr: MARK_ATTR, token }
      )
      .catch(() => null);
    if (!hostTag) break;

    const dialog = page.locator(`[${MARK_ATTR}="${token}"]`);
    const closeBtn = dialog
      .locator(
        'button.close-button, button[aria-label="Close dialog"], button:has(mat-icon:text-is("close"))'
      )
      .first();
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      // Another modal can stack above the promo and cover its close button
      // (empty notebooks auto-open Add-source); a DOM click is not intercepted.
      await closeBtn
        .click({ timeout: 3_000 })
        .catch(() => closeBtn.dispatchEvent("click"))
        .catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    const gone = await dialog
      .waitFor({ state: "detached", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!gone) {
      // Still open: it stays marked, so the Add-source selectors skip it.
      log.warning(`  ⚠️  Announcement dialog <${hostTag}> did not close; ignoring it`);
      continue;
    }
    log.info(`  🧹 Dismissed announcement dialog <${hostTag}>`);
    closed++;
  }
  return closed;
}
