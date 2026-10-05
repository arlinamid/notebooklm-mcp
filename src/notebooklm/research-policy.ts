/**
 * Guard rails around NotebookLM's own source discovery (Fast / Deep Research).
 *
 * Every research run spends the account's AI usage, and NotebookLM's picks
 * are often weak — popular pages, Wikipedia, marketing copy, a repository's
 * landing page instead of the paper. So the server:
 *   - refuses queries too vague to return focused results,
 *   - answers a repeated query from the notebook's research history,
 *   - imports only candidates the caller vetted, with a stated reason,
 *   - flags imported sources whose indexed text is suspiciously short.
 */

import type {
  ResearchCandidate,
  ResearchMode,
  ResearchCorpus,
  ResearchTask,
} from "./source-ops.js";

/** Indexed text below this many words usually is a landing page, paywall or cookie wall. */
export const THIN_SOURCE_WORDS = 500;

/** Web searches need context; Drive searches the user's own files, where a few keywords are precise. */
const MIN_QUERY_WORDS = { web: 4, drive: 2 } as const;
const MIN_REASON_CHARS = 20;

const QUERY_HELP =
  "Write one precise query: the subject + the specific aspect you need + the kind of source " +
  "wanted (official / regulatory, peer-reviewed, standard, primary data, manufacturer " +
  "documentation …) + timeframe or version + region or language when it matters. " +
  'Example: "EU AI Act Article 6 high-risk classification — official EU texts and ' +
  'Commission guidelines 2024-2026" instead of "AI Act".';

/** Null when the query is specific enough, else the reason it is refused. */
export function vagueQueryReason(query: string, corpus: ResearchCorpus = "web"): string | null {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]{2,}/u.test(w));
  if (words.length < MIN_QUERY_WORDS[corpus]) {
    return corpus === "drive"
      ? `The Drive query "${query.trim()}" is too vague. Name the files you look for — ` +
          "distinctive title words, the topic, the folder's theme — in at least 2 words."
      : `The research query "${query.trim()}" is too vague (${words.length} word` +
          `${words.length === 1 ? "" : "s"}). A vague query returns loosely related, popular ` +
          `pages and spends AI usage on a run you will have to repeat. ${QUERY_HELP}`;
  }
  return null;
}

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** An earlier run of the same query (same mode and corpus) in this notebook. */
export function findEarlierRun(
  tasks: ResearchTask[],
  query: string,
  mode: ResearchMode,
  corpus: ResearchCorpus
): ResearchTask | undefined {
  const want = normalizeQuery(query);
  return tasks.find(
    (t) => t.mode === mode && t.corpus === corpus && normalizeQuery(t.query) === want
  );
}

export interface ImportSelection {
  index: number;
  reliability: string;
  reason: string;
}

export interface VettedCandidate {
  candidate: ResearchCandidate;
  reliability: "high" | "medium";
  reason: string;
}

export interface Rejection {
  index: number;
  title?: string;
  reason: string;
}

/** Domains the user never wants imported (NOTEBOOKLM_RESEARCH_BLOCKED_DOMAINS, comma-separated). */
function blockedDomains(): string[] {
  return (process.env.NOTEBOOKLM_RESEARCH_BLOCKED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Split the caller's selections into importable candidates and rejections.
 * `existingUrls` are the notebook's current source URLs (no duplicates).
 */
export function vetSelections(
  task: ResearchTask,
  selections: ImportSelection[],
  existingUrls: Set<string>
): { accepted: VettedCandidate[]; rejected: Rejection[] } {
  const accepted: VettedCandidate[] = [];
  const rejected: Rejection[] = [];
  const blocked = blockedDomains();
  const seen = new Set<number>();
  for (const sel of selections) {
    const candidate = task.candidates.find((c) => c.index === sel.index);
    const reject = (reason: string) =>
      rejected.push({ index: sel.index, title: candidate?.title, reason });
    if (seen.has(sel.index)) continue;
    seen.add(sel.index);
    if (!candidate) {
      reject(`no candidate with index ${sel.index} in this research run`);
      continue;
    }
    const reliability = sel.reliability?.toLowerCase();
    if (reliability !== "high" && reliability !== "medium") {
      reject(
        `reliability "${sel.reliability}" — only candidates vetted as "high" or "medium" may be ` +
          "imported; leave unreliable ones out"
      );
      continue;
    }
    if (!sel.reason || sel.reason.trim().length < MIN_REASON_CHARS) {
      reject(
        "state why the source is reliable and relevant (who publishes it, primary or " +
          "secondary, date, what it covers for this question)"
      );
      continue;
    }
    if (!candidate.url) {
      reject("the candidate has no URL to import");
      continue;
    }
    // `imported` stays true after the source is deleted again, so go by the current URLs.
    if (existingUrls.has(candidate.url)) {
      reject("already in the notebook");
      continue;
    }
    const host = hostOf(candidate.url);
    if (host && blocked.some((d) => host === d || host.endsWith(`.${d}`))) {
      reject(`${host} is blocked by NOTEBOOKLM_RESEARCH_BLOCKED_DOMAINS`);
      continue;
    }
    accepted.push({ candidate, reliability, reason: sel.reason.trim() });
  }
  return { accepted, rejected };
}
