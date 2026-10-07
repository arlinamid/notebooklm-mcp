/**
 * Permanent deletion of sources, Studio outputs and notes (2026-09 UI).
 *
 *   source       → sidebar row "More" (`source-item-more-button-<uuid>`) →
 *                  "Remove source" (`delete` glyph) → `<delete-source>` dialog
 *   Studio item  → library item "More" → "Delete" → `<delete-dialog>`
 *   note         → library note "More" → "Delete" → `<delete-dialog>`
 *
 * Both confirm dialogs carry Cancel (plain) and Delete (tonal) buttons.
 * Nothing here can be undone — callers must require explicit confirmation.
 */

import type { Page, Request } from "patchright";
import { Selectors } from "./selectors.js";
import { listSources, resolveSourceIds } from "./source-select.js";
import { ensureStudioListView } from "./notes.js";
import { listStudioArtifacts } from "./studio.js";
import { requestContext } from "../utils/request-context.js";
import { safeSleep } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

export interface DeleteResult {
  deleted: string;
  kind: "source" | "studio_item" | "note";
}

/**
 * Click the tonal "Delete" button of the open confirm dialog, then wait for
 * the server to acknowledge. The UI removes some rows optimistically (sources
 * vanish before the request completes), so only the HTTP outcome of the first
 * `batchexecute` call after the click counts as success.
 */
async function confirmDelete(page: Page, hostTag: string): Promise<void> {
  const dialog = page.locator(`mat-dialog-container:has(${hostTag})`).first();
  await dialog.waitFor({ state: "visible", timeout: 6_000 });

  let onRequest: ((req: Request) => void) | null = null;
  const serverOutcome = new Promise<string>((resolve) => {
    onRequest = (req) => {
      if (req.method() !== "POST" || !/\/batchexecute/.test(req.url())) return;
      page.off("request", onRequest!);
      req
        .response()
        .then((res) => resolve(res && res.ok() ? "ok" : `HTTP ${res?.status() ?? "failed"}`))
        .catch(() => resolve("failed"));
    };
    page.on("request", onRequest);
  });

  const ok = await page.evaluate((host) => {
    const d = Array.from(document.querySelectorAll("mat-dialog-container")).find((c) =>
      c.querySelector(host)
    );
    const btn = d?.querySelector<HTMLButtonElement>("button.mat-tonal-button");
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }, hostTag);
  if (!ok) {
    if (onRequest) page.off("request", onRequest);
    throw new Error("Could not find the Delete confirmation button.");
  }
  const outcome = await Promise.race([
    serverOutcome,
    new Promise<string>((r) => setTimeout(() => r("no request"), 15_000)),
  ]);
  if (onRequest) page.off("request", onRequest);
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  if (outcome !== "ok") {
    throw new Error(
      `NotebookLM did not confirm the deletion (${outcome}); nothing may have been deleted.`
    );
  }
}

async function clickDeleteMenuItem(page: Page): Promise<void> {
  const item = page.locator(Selectors.deletion.menuItem).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
}

export interface DeleteTarget {
  id: string;
  title: string;
  kind: "source" | "studio_item" | "note" | "chat_history";
}

/** Resolve a source reference without changing anything (for approval prompts). */
export async function resolveSourceTarget(page: Page, ref: string): Promise<DeleteTarget> {
  const items = await listSources(page);
  const [id] = [...(await resolveSourceIds(items, [ref]))];
  return { id, title: items.find((i) => i.id === id)?.title ?? ref, kind: "source" };
}

/** Resolve a Studio output / note reference without changing anything. */
export async function resolveStudioTarget(
  page: Page,
  ref: string,
  kind?: "note" | "studio_item"
): Promise<DeleteTarget> {
  const all = (await listStudioArtifacts(page)).filter((a) =>
    kind === "note" ? a.type === "note" : kind === "studio_item" ? a.type !== "note" : true
  );
  const q = ref.trim().toLowerCase();
  let hits = all.filter((a) => a.id && a.id === ref.trim());
  if (hits.length === 0) hits = all.filter((a) => a.title.toLowerCase() === q);
  if (hits.length === 0) hits = all.filter((a) => a.title.toLowerCase().includes(q));
  if (hits.length !== 1) {
    const candidates = hits.length > 1 ? hits : all;
    const chosen = await requestContext()?.choose?.(
      hits.length > 1
        ? `Several Studio entries match "${ref}". Which one do you mean?`
        : `No Studio entry matches "${ref}". Pick the one you meant:`,
      candidates.map((a) => ({
        value: a.id,
        label: `[${a.type}] ${a.title}${a.details ? ` — ${a.details}` : ""}`,
      }))
    );
    const picked = chosen ? all.find((a) => a.id === chosen) : undefined;
    if (picked) {
      return {
        id: picked.id,
        title: picked.title,
        kind: picked.type === "note" ? "note" : "studio_item",
      };
    }
    const list = all.map((a) => `"${a.title}" (${a.id})`).join(", ");
    throw new Error(
      hits.length
        ? `"${ref}" matches several entries — use the id. Entries: ${list}`
        : `No Studio entry matches "${ref}". Entries: ${list}`
    );
  }
  const hit = hits[0];
  return { id: hit.id, title: hit.title, kind: hit.type === "note" ? "note" : "studio_item" };
}

/** Delete one source (id, exact title, or unique title substring). */
export async function deleteSource(page: Page, ref: string): Promise<DeleteResult> {
  const items = await listSources(page);
  const [id] = [...(await resolveSourceIds(items, [ref]))];
  const title = items.find((i) => i.id === id)?.title ?? ref;

  const opened = await page.evaluate((btnId) => {
    const btn = document.getElementById(btnId) as HTMLElement | null;
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  }, `${Selectors.sources.rowIdPrefix}${id}`);
  if (!opened) throw new Error(`Could not open the menu of source "${title}".`);
  await clickDeleteMenuItem(page);
  await confirmDelete(page, Selectors.deletion.sourceDialogHost);

  // Verify by id: the row must disappear.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await listSources(page)).some((s) => s.id === id)) {
      log.success(`  🗑️  Source deleted: ${title}`);
      return { deleted: title, kind: "source" };
    }
    await safeSleep(page, 500);
  }
  throw new Error(`Delete was confirmed but source "${title}" is still listed.`);
}

/**
 * Delete a Studio output or note by title (exact, else unique substring).
 * `kind` narrows the search to notes or to generated outputs.
 */
export async function deleteStudioEntry(
  page: Page,
  title: string,
  kind?: "note" | "studio_item"
): Promise<DeleteResult> {
  await ensureStudioListView(page);
  const selector =
    kind === "note"
      ? Selectors.notes.libraryNote
      : kind === "studio_item"
        ? "artifact-library-item"
        : `artifact-library-item, ${Selectors.notes.libraryNote}`;

  const pick = await page.evaluate(
    ({ selector, wanted }) => {
      const els = Array.from(document.querySelectorAll(selector));
      const titles = els.map((e) => (e.querySelector(".artifact-title")?.textContent ?? "").trim());
      const ids = els.map((e) =>
        (e.querySelector("[id^='artifact-labels-'], [id^='note-labels-']")?.id ?? "").replace(
          /^(artifact|note)-labels-/,
          ""
        )
      );
      const q = wanted.trim().toLowerCase();
      // An exact id (from list_studio_artifacts) wins — the only way to tell
      // entries with identical titles apart.
      let hits = ids.map((id, i) => (id && id === wanted.trim() ? i : -1)).filter((i) => i >= 0);
      if (hits.length === 0)
        hits = titles.map((t, i) => (t.toLowerCase() === q ? i : -1)).filter((i) => i >= 0);
      if (hits.length === 0)
        hits = titles.map((t, i) => (t.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) return { error: hits.length ? "ambiguous" : "notfound", titles };
      const el = els[hits[0]];
      const btn = Array.from(el.querySelectorAll<HTMLElement>("button")).find(
        (b) => b.querySelector("mat-icon")?.textContent?.trim() === "more_vert"
      );
      if (!btn) return { error: "nomenu", titles };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return {
        title: titles[hits[0]],
        isNote: el.tagName.toLowerCase() === "artifact-library-note",
        count: els.length,
      };
    },
    { selector, wanted: title }
  );
  if ("error" in pick) {
    const list = (pick.titles ?? []).map((t) => `"${t}"`).join(", ");
    throw new Error(
      pick.error === "ambiguous"
        ? `"${title}" matches several entries (${list}) — use the entry's id from list_studio_artifacts.`
        : pick.error === "notfound"
          ? `No Studio entry titled "${title}". Entries: ${list}`
          : `Could not open the menu of "${title}".`
    );
  }

  await clickDeleteMenuItem(page);
  await confirmDelete(page, Selectors.deletion.studioDialogHost);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const n = await page.locator(selector).count();
    if (n < pick.count) {
      log.success(`  🗑️  Deleted ${pick.isNote ? "note" : "Studio item"}: ${pick.title}`);
      return { deleted: pick.title, kind: pick.isNote ? "note" : "studio_item" };
    }
    await safeSleep(page, 500);
  }
  throw new Error(`Delete was confirmed but "${pick.title}" is still listed.`);
}
