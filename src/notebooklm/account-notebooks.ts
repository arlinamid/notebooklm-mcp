/**
 * Notebooks of the signed-in Google account. Read with one RPC
 * (`listAccountNotebooksRpc`); the homepage scrape below is the fallback for
 * when that RPC changes (2026-10 "Gemini Notebook" layout).
 *
 * The homepage opens on "All" (Featured + a handful of recent notebooks), so
 * the full listing needs a filter button: "My notebooks" or "Shared with me".
 * Those buttons carry no stable attribute, so they are found by position
 * around the "Discover" button, whose `public` glyph is language-free.
 * Both the grid view (cards) and the list view (table rows) are parsed — the
 * view is a user preference and is left as it is.
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
import { safeSleep } from "../browser/watchdog.js";
import { NOTEBOOKLM_BASE_URL } from "../config.js";
import { log } from "../utils/logger.js";
import { RpcError } from "./rpc.js";
import { listAccountNotebooksRpc } from "./rpc-ops.js";

export type AccountNotebookScope = "mine" | "shared";

export interface AccountNotebook {
  /** NotebookLM's own notebook id (the UUID in the URL). */
  uuid: string;
  url: string;
  title: string;
  emoji: string | null;
  sources: number | null;
  /** ISO timestamp when the UI exposes a parseable date, else null. */
  created_at: string | null;
  scope: AccountNotebookScope;
  /** True when the card shows the "anyone with the link" glyph (grid view only). */
  public: boolean;
}

const UUID_RE = /\/notebook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** The NotebookLM UUID of a notebook URL, or null. */
export function notebookUuidFromUrl(url: string): string | null {
  return url.match(UUID_RE)?.[1]?.toLowerCase() ?? null;
}

/** Navigate `page` to the homepage and list the account's notebooks. */
export async function listAccountNotebooks(
  page: Page,
  scopes: AccountNotebookScope[]
): Promise<AccountNotebook[]> {
  await page.goto(NOTEBOOKLM_BASE_URL, { waitUntil: "domcontentloaded" });
  const landed = page.url();
  if (/accounts\.google\.com|\/trynow/.test(landed)) {
    throw new Error(
      "Not signed in to NotebookLM (homepage redirected to the sign-in page). Run setup_auth."
    );
  }
  // One RPC returns every notebook with owner/created data; the homepage
  // filters below are the fallback for when Google rotates the RPC id.
  try {
    return await listAccountNotebooksRpc(page, scopes);
  } catch (error) {
    if (!(error instanceof RpcError) || error.code === 16) throw error;
    log.warning(`  ⚠️  Notebook list RPC failed (${error.message}) — reading the homepage instead`);
  }

  await page
    .locator(Selectors.notebooks.homeFilterButton)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch((e: unknown) => {
      throw new Error(
        "NotebookLM homepage filter row not found (layout changed, or the browser " +
          "viewport is too narrow — it collapses below ~1200px).",
        { cause: e }
      );
    });

  const row = await settledFilterRow(page);
  const all: AccountNotebook[] = [];
  try {
    for (const scope of scopes) {
      const index = filterIndex(row.icons, scope);
      if (index < 0) {
        // The row only offers filters that have content.
        log.info(`  📚 ${scope}: no filter on the homepage — nothing to list`);
        continue;
      }
      await selectFilter(page, index);
      await loadAll(page);
      const found = await readListing(page, scope);
      log.info(`  📚 ${scope}: ${found.length} notebook(s)`);
      all.push(...found.filter((nb) => !all.some((a) => a.uuid === nb.uuid)));
    }
  } finally {
    // NotebookLM remembers the selected filter; put the user's choice back.
    if (row.selected >= 0) await selectFilter(page, row.selected).catch(() => undefined);
  }
  return all;
}

interface FilterRow {
  /** Glyph of each filter button ("" for text-only ones). */
  icons: string[];
  /** Index of the selected (tonal) button, -1 if none. */
  selected: number;
}

function readFilterRow(page: Page): Promise<FilterRow> {
  return page.locator(Selectors.notebooks.homeFilterButton).evaluateAll((els) => ({
    icons: els.map((b) => b.querySelector("mat-icon")?.textContent?.trim() ?? ""),
    selected: els.findIndex((b) =>
      b.closest("nb-button")?.classList.contains("nb-button-type-tonal")
    ),
  }));
}

/**
 * The row starts as All · Discover · Collections; "My notebooks" and
 * "Shared with me" are inserted once the account's notebooks have loaded.
 */
async function settledFilterRow(page: Page): Promise<FilterRow> {
  let row = await readFilterRow(page);
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    await safeSleep(page, 500);
    const next = await readFilterRow(page);
    const loaded = (await page.locator(Selectors.notebooks.homeLink).count()) > 0;
    stable = loaded && next.icons.join("|") === row.icons.join("|") ? stable + 1 : 0;
    row = next;
  }
  return row;
}

/**
 * Index of the filter for `scope`, located around Discover (`public`
 * glyph): All · [My notebooks] · Discover · [Shared with me] · Collections.
 */
function filterIndex(icons: string[], scope: AccountNotebookScope): number {
  const discover = icons.indexOf("public");
  if (discover < 0) return icons.length >= 5 ? (scope === "mine" ? 1 : 3) : -1;
  if (scope === "mine") return discover >= 2 ? discover - 1 : -1;
  return discover + 2 < icons.length ? discover + 1 : -1;
}

/** Click filter `index` and wait until it is the selected one. */
async function selectFilter(page: Page, index: number): Promise<void> {
  const heading = () =>
    page
      .locator(Selectors.notebooks.homeSectionHeading)
      .first()
      .innerText()
      .catch(() => "");
  const before = await heading();
  await page.locator(Selectors.notebooks.homeFilterButton).nth(index).click();
  for (let i = 0; (await readFilterRow(page)).selected !== index; i++) {
    if (i >= 20) throw new Error("NotebookLM homepage filter did not switch.");
    await safeSleep(page, 500);
  }
  // The listing re-renders right after the selection flips; the heading
  // changes with it (unless this filter was already selected).
  for (let i = 0; i < 10 && (await heading()) === before; i++) await safeSleep(page, 500);
}

/** Scroll until the number of notebook links stops growing. */
async function loadAll(page: Page): Promise<void> {
  const links = page.locator(Selectors.notebooks.homeLink);
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    const n = await links.count();
    stable = n === last ? stable + 1 : 0;
    last = n;
    if (n > 0)
      await links
        .nth(n - 1)
        .scrollIntoViewIfNeeded()
        .catch(() => undefined);
    await safeSleep(page, 600);
  }
}

async function readListing(page: Page, scope: AccountNotebookScope): Promise<AccountNotebook[]> {
  const S = Selectors.notebooks;
  const raw = await page.evaluate(
    ({ link, card, row, featured }) => {
      const text = (el: Element | null | undefined) =>
        (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      return Array.from(document.querySelectorAll<HTMLAnchorElement>(link)).map((a) => {
        const href = a.getAttribute("href") ?? "";
        const c = a.closest(card);
        if (c) {
          const id = href.split("/notebook/")[1]?.split(/[?#/]/)[0] ?? "";
          return {
            href,
            featured: !!c.querySelector(featured),
            title: text(c.querySelector(".project-button-title")),
            emoji: text(document.getElementById(`project-${id}-emoji`)),
            date: c.querySelector(".project-button-subtitle-part[title]")?.getAttribute("title"),
            sources: text(c.querySelector(".project-button-subtitle-part-sources")),
            isPublic: text(document.getElementById(`project-${id}-sharing-status`)) === "public",
          };
        }
        const r = a.closest(row);
        return {
          href,
          featured: false,
          title: a.getAttribute("title")?.trim() || text(a),
          emoji: text(a.querySelector(".project-table-emoji")),
          date: text(r?.querySelector(".cdk-column-createTime")),
          sources: text(r?.querySelector(".cdk-column-numSources")),
          isPublic: false,
        };
      });
    },
    { link: S.homeLink, card: S.homeCard, row: S.homeRow, featured: S.featuredCard }
  );

  const seen = new Set<string>();
  const out: AccountNotebook[] = [];
  for (const r of raw) {
    const uuid = notebookUuidFromUrl(r.href);
    if (!uuid || r.featured || seen.has(uuid)) continue;
    seen.add(uuid);
    const time = r.date ? Date.parse(r.date) : NaN;
    const sources = r.sources.match(/\d+/)?.[0];
    let title = r.title;
    if (r.emoji && title.startsWith(r.emoji)) title = title.slice(r.emoji.length).trim();
    out.push({
      uuid,
      url: new URL(`/notebook/${uuid}`, NOTEBOOKLM_BASE_URL).toString(),
      title: title || "Untitled notebook",
      emoji: r.emoji || null,
      sources: sources ? Number(sources) : null,
      created_at: Number.isNaN(time) ? null : new Date(time).toISOString(),
      scope,
      public: r.isPublic,
    });
  }
  return out;
}
