#!/usr/bin/env node
/**
 * Convert NotebookLM flashcards or quiz JSON (download_studio_artifact with
 * format "json") into a tab-separated file Anki imports as Basic notes.
 *
 *   node to-anki.mjs <file.json> [out.tsv]
 *
 * Flashcards: { "flashcards": [{ "f": front, "b": back }] }
 * Quiz:       { "quiz": [{ "question", "answerOptions": [{ "text", "isCorrect" }], "hint" }] }
 * No dependencies; Node 18+.
 */
import fs from "node:fs";
import path from "node:path";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node to-anki.mjs <flashcards-or-quiz.json> [out.tsv]");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(input, "utf8"));
} catch (error) {
  console.error(`Cannot read ${input} as JSON: ${error.message}`);
  process.exit(1);
}

// Anki's text import: one note per line, fields separated by tabs; HTML allowed.
const clean = (s) =>
  String(s ?? "")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, "<br>")
    .trim();

const rows = [];
if (Array.isArray(data.flashcards)) {
  for (const card of data.flashcards) {
    if (card?.f || card?.b) rows.push([clean(card.f), clean(card.b)]);
  }
} else if (Array.isArray(data.quiz)) {
  for (const q of data.quiz) {
    const options = Array.isArray(q?.answerOptions) ? q.answerOptions : [];
    const correct = options.filter((o) => o?.isCorrect).map((o) => clean(o.text));
    const front = [clean(q?.question), ...options.map((o, i) => `${"ABCDEFGH"[i] ?? i + 1}) ${clean(o?.text)}`)].join("<br>");
    const back = [correct.join(" / "), q?.hint ? `<i>${clean(q.hint)}</i>` : ""].filter(Boolean).join("<br>");
    if (front) rows.push([front, back]);
  }
} else {
  console.error('No "flashcards" or "quiz" array found — download with format "json".');
  process.exit(1);
}

const out = output ?? path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.anki.tsv`);
const header = "#separator:tab\n#html:true\n#columns:Front\tBack\n";
fs.writeFileSync(out, header + rows.map((r) => r.join("\t")).join("\n") + "\n", "utf8");
console.log(`${rows.length} notes → ${out}`);
