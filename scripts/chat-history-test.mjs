#!/usr/bin/env node
/**
 * Offline test of the chat-history reader (no browser, no Google account):
 * a fake page answers the batchexecute RPCs the way NotebookLM does —
 * conversations (hPTbtc), notebook details (rLM1Ne) and cursor-paged turns,
 * newest first (khqZz) — so paging, the `max_turns` cap, citation parsing,
 * the Markdown / JSON export and the file writer run on realistic shapes.
 *
 *   npm run build && node scripts/chat-history-test.mjs
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteChatHistoryRpc,
  exportChatHistory,
  formatChatHistoryMarkdown,
  parseTurn,
  readChatHistory,
} from "../dist/notebooklm/chat-history.js";
import { RpcError } from "../dist/notebooklm/rpc.js";

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const NB = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const SRC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SRC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// --- turn builders (shapes taken from live responses, 2026-10) -------------
const detail = (srcId, excerpt) => [
  null,
  null,
  1,
  [[null, 1, 1]],
  [[[0, 5, [[[null, null, excerpt]]]]]],
  [[[srcId], "ref"]],
  ["x"],
];
const question = (i) => [`q-${i}`, [1_790_000_000 + i * 60, 0], 1, `Question ${i}`, null, 1];
const answer = (i, text, passages) => [
  `a-${i}`,
  [1_790_000_030 + i * 60, 500_000_000],
  2,
  null,
  [
    [
      text,
      null,
      [CONV, CONV, 1],
      null,
      [
        [[[0, 1, [[[0, 1, ["seg"]]]]]]],
        // decoy: looks like a passage list but carries no source id
        [[["d1"], [null, 1, 1]]],
        null,
        null,
        passages.map(([src, excerpt], k) => [[`p${k}`], detail(src, excerpt)]),
        1,
      ],
    ],
  ],
  1,
];

/** 45 turns, oldest first: Q1 A1 Q2 A2 … Q23. */
function buildTurns() {
  const turns = [];
  for (let i = 1; i <= 23; i++) {
    turns.push(question(i));
    if (i < 23) {
      turns.push(
        i === 22
          ? answer(i, "Fees are 20 USD [1, 2] and 12 USD per year [1-3].", [
              [SRC_A, "Activation fee: $20 one-time."],
              [SRC_B, "Maintenance fee: $12 per year."],
              [SRC_A, "Waived above $100 net royalties."],
            ])
          : answer(i, `Answer ${i} without citations.`, [])
      );
    }
  }
  return turns;
}

// --- fake page ---------------------------------------------------------------
function fakePage({
  turns = [],
  conversations = true,
  nullSources = false,
  stuckCursor = false,
  deleteIgnored = false,
}) {
  const calls = { khqZz: 0, hPTbtc: 0, rLM1Ne: 0, J7Gthc: 0 };
  const newestFirst = [...turns].reverse();
  const deletes = [];
  const reply = (rpcId, result) => ({
    status: 200,
    text: `)]}'\n\n100\n${JSON.stringify([["wrb.fr", rpcId, JSON.stringify(result), null, null, null, "generic"]])}\n`,
  });
  return {
    calls,
    deletes,
    evaluate: async (_fn, { rpcId, params }) => {
      calls[rpcId] = (calls[rpcId] ?? 0) + 1;
      if (rpcId === "J7Gthc") {
        // DeleteChatTurns: [HEADER, conversationId, null, 1] → [] (the conversation stays, empty)
        deletes.push(params);
        if (!deleteIgnored && params[1] === CONV) newestFirst.length = 0;
        return reply(rpcId, []);
      }
      if (rpcId === "rLM1Ne") {
        return reply(rpcId, [
          [
            "Test Notebook",
            nullSources
              ? null
              : [
                  [[SRC_A], "Source A"],
                  [[SRC_B], "Source B"],
                ],
          ],
        ]);
      }
      if (rpcId === "hPTbtc") {
        return reply(rpcId, [conversations ? [[CONV, [1_790_000_000, 0], [1_790_003_000, 0]]] : []]);
      }
      if (rpcId === "khqZz") {
        const [, , , , limit, cursor] = params;
        const offset = cursor ? Number(String(cursor).replace("c", "")) : 0;
        const page = newestFirst.slice(offset, offset + limit);
        const next = offset + limit;
        if (stuckCursor) return reply(rpcId, [page, "c0"]);
        return reply(rpcId, next < newestFirst.length ? [page, `c${next}`] : [page]);
      }
      throw new Error(`unexpected rpc ${rpcId}`);
    },
  };
}

// --- tests -------------------------------------------------------------------
const turns = buildTurns();

{
  const page = fakePage({ turns });
  const h = await readChatHistory(page, NB);
  check(h.turns.length === 45, "reads every page of a long chat", `${h.turns.length} turns`);
  check(page.calls.khqZz === 3, "pages with the cursor (20 + 20 + 5)", `${page.calls.khqZz} requests`);
  check(
    h.turns[0].role === "user" && h.turns[0].text === "Question 1" && h.turns[0].n === 1,
    "oldest turn first"
  );
  check(h.turns[44].text === "Question 23" && h.turns[44].n === 45, "newest turn last");
  check(h.notebookTitle === "Test Notebook" && h.conversationId === CONV, "title + conversation id");
  check(!h.truncated, "complete chat is not marked truncated");
  const cited = h.turns.find((t) => t.citations);
  check(
    cited?.text.includes("[1][2]") && cited.text.includes("[1][2][3]"),
    "citation ranges expanded",
    cited?.text
  );
  check(
    cited?.citations?.length === 3 &&
      cited.citations[0].source === "Source A" &&
      cited.citations[1].source === "Source B" &&
      cited.citations[0].excerpt.startsWith("Activation fee"),
    "citations carry source title and excerpt, decoy list ignored"
  );
}

{
  const page = fakePage({ turns });
  const h = await readChatHistory(page, NB, { maxTurns: 5, includeCitations: false });
  check(h.turns.length === 5 && h.truncated, "max_turns keeps the newest and flags truncation");
  check(h.turns[4].text === "Question 23", "max_turns keeps the newest turn");
  check(page.calls.khqZz === 1, "max_turns stops paging early", `${page.calls.khqZz} request`);
  check(!h.turns.some((t) => t.citations), "include_citations false drops citations");
}

{
  const page = fakePage({ turns: [], conversations: false, nullSources: true });
  const h = await readChatHistory(page, NB);
  check(h.turns.length === 0 && h.conversationId === null, "notebook without conversation");
  check(page.calls.khqZz === 0, "no turn request without a conversation");
}

{
  const page = fakePage({ turns: turns.slice(0, 4), nullSources: true });
  const h = await readChatHistory(page, NB);
  check(h.turns.length === 4, "empty-notebook null source list is tolerated");
}

{
  const page = fakePage({ turns, stuckCursor: true });
  const h = await readChatHistory(page, NB);
  check(page.calls.khqZz <= 3 && h.truncated, "a cursor that never advances ends the loop", `${page.calls.khqZz} requests`);
}

{
  check(parseTurn([], () => "x", true) === null, "unknown turn kind is skipped");
}

{
  const page = fakePage({ turns });
  const r = await deleteChatHistoryRpc(page, NB);
  const p = page.deletes[0];
  check(r.deleted_messages === 45, "delete reports how many messages went", `${r.deleted_messages}`);
  check(
    page.deletes.length === 1 && p[1] === CONV && p[2] === null && p[3] === 1 && Array.isArray(p[0]),
    "delete sends [header, conversationId, null, 1]"
  );
  const after = await readChatHistory(page, NB);
  check(after.turns.length === 0 && after.conversationId === CONV, "history is empty after the delete");

  const empty = await deleteChatHistoryRpc(page, NB).then(
    () => null,
    (e) => e
  );
  check(
    empty instanceof Error && !(empty instanceof RpcError) && page.deletes.length === 1,
    "deleting an empty chat is a plain error and sends nothing",
    empty?.message
  );
}

{
  const page = fakePage({ turns, deleteIgnored: true });
  const err = await deleteChatHistoryRpc(page, NB, 600).then(
    () => null,
    (e) => e
  );
  check(
    err instanceof RpcError && err.rpcId === "J7Gthc",
    "a delete that leaves the history in place is an RpcError (UI fallback)",
    err?.message
  );
}

{
  const page = fakePage({ turns });
  const h = await readChatHistory(page, NB);
  const md = formatChatHistoryMarkdown(h, { exportedAt: new Date("2026-10-07T08:00:00Z") });
  check(md.startsWith("# Chat history — Test Notebook"), "markdown heading");
  check(md.includes("## 1. Question") && md.includes("## 45. Question"), "markdown numbers every message");
  check(
    md.includes("- [1] Source A — \"Activation fee: $20 one-time.\""),
    "markdown lists cited sources"
  );
  check(md.includes("Messages: 45 (23 questions, 22 answers)"), "markdown summary line");

  const dir = mkdtempSync(join(tmpdir(), "nlm-chat-"));
  try {
    const a = await exportChatHistory(h, "markdown", dir);
    const b = await exportChatHistory(h, "markdown", dir);
    const files = readdirSync(dir);
    check(
      files.length === 2 && a.file_path !== b.file_path && /\(2\)\.md$/.test(b.file_path),
      "never overwrites an existing export",
      files.join(", ")
    );
    const j = await exportChatHistory(h, "json", dir);
    const parsed = JSON.parse(readFileSync(j.file_path, "utf8"));
    check(parsed.turns.length === 45 && parsed.conversationId === CONV, "json export parses back");
    const inline = await exportChatHistory(h, "json");
    check(inline.history?.turns.length === 45 && !inline.file_path, "inline json export");
    const inlineMd = await exportChatHistory(h, "markdown");
    check(typeof inlineMd.markdown === "string" && inlineMd.messages === 45, "inline markdown export");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll chat-history checks passed");
