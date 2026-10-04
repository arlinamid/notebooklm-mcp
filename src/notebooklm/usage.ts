/**
 * AI usage & limits (Settings → Usage), introduced with the 2026-09
 * "Gemini Notebook" rebrand. The fixed "50 queries/day" quota was replaced by
 * metered AI usage with two windows, shown as percentages:
 *
 *   - a short rolling window ("Current … AI usage", resets every ~5 hours)
 *   - a weekly limit
 *
 * Studio generations additionally show a usage meter in their dialog footer
 * (see `readUsagePercent` in studio.ts), and "Generate later" queues work
 * outside the current window.
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { safeSleep } from "../browser/watchdog.js";

export interface UsageWindow {
  /** Label as shown in the UI, e.g. "Current Gemini Notebook AI usage" / "Weekly limit". */
  label: string;
  percentUsed: number;
  /** Reset text as shown in the UI, e.g. "Resets at 10:57 PM". */
  resets: string | null;
}

export interface UsageInfo {
  windows: UsageWindow[];
  /** Raw dialog text, for callers that need details we don't parse. */
  raw: string;
}

/** Open the usage dialog, parse it, close it again. */
export async function readUsage(page: Page): Promise<UsageInfo> {
  await clickFirst(page, Selectors.settings.menuButton, "Settings button");
  await safeSleep(page, 300);
  await clickFirst(page, Selectors.settings.usageMenuItem, "Usage menu item");

  const dialog = page.locator(Selectors.settings.usageDialog).first();
  await dialog.waitFor({ state: "visible", timeout: 8_000 });
  await safeSleep(page, 800);
  const raw = (await dialog.innerText().catch(() => "")).trim();
  await page.keyboard.press("Escape").catch(() => undefined);

  return { windows: parseUsageText(raw), raw };
}

/**
 * Pull "<label> / NN% used / Resets …" triples out of the dialog text. A
 * percentage line anchors each window; the nearest preceding non-numeric line
 * is its label, the following line its reset time.
 */
export function parseUsageText(raw: string): UsageWindow[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const windows: UsageWindow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (!m) continue;
    // Label may sit on the same line ("Weekly limit 1% used") or the line before.
    const sameLineLabel = lines[i].slice(0, m.index).trim();
    const label = sameLineLabel || lines[i - 1] || "";
    const next = lines[i + 1] ?? null;
    const resets = next && !/%/.test(next) ? next : null;
    windows.push({ label, percentUsed: Number(m[1].replace(",", ".")), resets });
  }
  return windows;
}

async function clickFirst(page: Page, selectors: readonly string[], label: string): Promise<void> {
  // Menus animate in; `isVisible` doesn't wait, so wait on the combined
  // selector first, then click whichever alternative is showing.
  await page
    .locator(selectors.join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click();
      return;
    }
  }
  throw new Error(`Could not find ${label} — NotebookLM UI may have changed.`);
}
