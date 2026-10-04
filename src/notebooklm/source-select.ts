/**
 * Source listing and selection.
 *
 * The left sidebar lists every source as `.single-source-container`; the
 * source UUID is embedded in the row's "More" button id
 * (`source-item-more-button-<uuid>`) and a `mat-checkbox` controls whether the
 * source is used by the chat ("N sources" in the query box). Studio dialogs
 * have their own per-job picker (see `selectStudioSources`).
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { safeSleep } from "../browser/watchdog.js";
import { requestContext } from "../utils/request-context.js";

export interface NotebookSource {
  id: string;
  title: string;
  /** Material glyph of the source type (e.g. `description`, `markdown`), or `web`. */
  kind: string;
  /** Whether the source is currently selected for the chat. */
  selected: boolean;
}

/**
 * Resolve user-supplied source references (UUID, exact title, unique
 * case-insensitive title substring) to ids. When a reference is ambiguous
 * (several sources share the title) or matches nothing, the user is asked to
 * pick from the candidates via MCP elicitation; without that UI — or when the
 * user declines — it throws with the list of available titles and ids.
 */
export async function resolveSourceIds(
  items: Array<{ id: string; title: string }>,
  wanted: string[]
): Promise<Set<string>> {
  if (wanted.length === 0) throw new Error("`sources` must name at least one source.");
  const ids = new Set<string>();
  for (const w of wanted) {
    const raw = w.trim();
    const q = raw.toLowerCase();
    let hit = items.filter((i) => i.id === raw);
    if (hit.length === 0) hit = items.filter((i) => i.title.toLowerCase() === q);
    if (hit.length === 0) hit = items.filter((i) => i.title.toLowerCase().includes(q));
    if (hit.length === 1) {
      ids.add(hit[0].id);
      continue;
    }
    const candidates = hit.length > 1 ? hit : items;
    const chosen = await requestContext()?.choose?.(
      hit.length > 1
        ? `Several sources match "${w}". Which one do you mean?`
        : `No source matches "${w}". Pick the source you meant:`,
      candidates.map((i) => ({ value: i.id, label: `${i.title} (${i.id.slice(0, 8)})` }))
    );
    if (chosen) {
      ids.add(chosen);
      continue;
    }
    throw new Error(
      `Source "${w}" ${hit.length === 0 ? "not found" : "is ambiguous — use its id"}. Available: ` +
        items.map((i) => `"${i.title}" (${i.id})`).join(", ")
    );
  }
  return ids;
}

/** Every source in the sidebar, in display order. */
export async function listSources(page: Page): Promise<NotebookSource[]> {
  return page.evaluate(
    ({ rowSel, idPrefix }) =>
      Array.from(document.querySelectorAll(rowSel)).map((row) => {
        const more = row.querySelector(`[id^="${idPrefix}"]`);
        const icon = row.querySelector(
          ".source-item-source-icon, .source-item-icon-container mat-icon"
        );
        const checkbox = row.querySelector<HTMLInputElement>("input[type=checkbox]");
        return {
          id: more?.id.slice(idPrefix.length) ?? "",
          title: (row.querySelector(".source-title")?.textContent ?? "").trim(),
          kind: icon?.textContent?.trim() || "web",
          selected: !!checkbox?.checked,
        };
      }),
    { rowSel: Selectors.sources.sourceContainer, idPrefix: Selectors.sources.rowIdPrefix }
  );
}

/** Make exactly `ids` selected in the sidebar (DOM-order clicks, then verify). */
async function applySelection(page: Page, ids: Set<string>): Promise<void> {
  await page.evaluate(
    ({ rowSel, idPrefix, want }) => {
      for (const row of Array.from(document.querySelectorAll(rowSel))) {
        const id = row.querySelector(`[id^="${idPrefix}"]`)?.id.slice(idPrefix.length) ?? "";
        const cb = row.querySelector<HTMLInputElement>("input[type=checkbox]");
        if (cb && cb.checked !== want.includes(id)) cb.click();
      }
    },
    {
      rowSel: Selectors.sources.sourceContainer,
      idPrefix: Selectors.sources.rowIdPrefix,
      want: [...ids],
    }
  );
  await safeSleep(page, 600);
  const now = await listSources(page);
  const wrong = now.filter((s) => s.selected !== ids.has(s.id));
  if (wrong.length) {
    throw new Error(`Could not set source selection for: ${wrong.map((s) => s.title).join(", ")}`);
  }
}

/**
 * Restrict the chat to `wanted` sources. Returns the previous selection so the
 * caller can restore it with `restoreChatSources`.
 */
export async function setChatSources(
  page: Page,
  wanted: string[]
): Promise<{ previous: Set<string>; selected: string[] }> {
  const items = await listSources(page);
  if (items.length === 0) throw new Error("This notebook has no sources.");
  const ids = await resolveSourceIds(items, wanted);
  const previous = new Set(items.filter((i) => i.selected).map((i) => i.id));
  await applySelection(page, ids);
  return { previous, selected: items.filter((i) => ids.has(i.id)).map((i) => i.title) };
}

export async function restoreChatSources(page: Page, previous: Set<string>): Promise<void> {
  await applySelection(page, previous);
}
