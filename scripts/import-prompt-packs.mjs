#!/usr/bin/env node
/**
 * Import community prompt packs for the MCP `prompts` feature.
 *
 *   node scripts/import-prompt-packs.mjs            # refresh the bundled MIT packs
 *   node scripts/import-prompt-packs.mjs --styles   # + download prompt-styles for personal use
 *
 * Bundled (redistributed under their MIT licenses, see prompts/THIRD_PARTY_NOTICES.md):
 *   - arlinamid/notebooklm-browser-plugin  → prompts/packs/browser-plugin.json
 *   - DrMultivac/notebooklm-learner-pack   → prompts/packs/learner-pack.json
 *
 * NOT bundled: YamilAyma/notebooklm-prompt-styles ships no license that grants
 * redistribution (its README only describes copy-pasting the YAML into
 * NotebookLM). `--styles` therefore downloads the YAML files into the *user's*
 * data directory (…/notebooklm-mcp/prompt-packs/notebooklm-prompt-styles),
 * where the server picks them up for that user only.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import envPaths from "env-paths";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "prompts");

async function gh(pathname) {
  const res = await fetch(`https://api.github.com/${pathname}`, {
    headers: { "User-Agent": "notebooklm-mcp-import", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${pathname}: HTTP ${res.status}`);
  return res.json();
}

async function raw(repo, sha, file) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`);
  if (!res.ok) throw new Error(`raw ${repo}/${file}: HTTP ${res.status}`);
  return res.text();
}

async function headSha(repo) {
  return (await gh(`repos/${repo}/commits/HEAD`)).sha;
}

// ---------------------------------------------------------------------------
// arlinamid/notebooklm-browser-plugin — data/templates.json (EN + HU entries)
// ---------------------------------------------------------------------------
async function importBrowserPlugin() {
  const repo = "arlinamid/notebooklm-browser-plugin";
  const sha = await headSha(repo);
  const list = JSON.parse(await raw(repo, sha, "data/templates.json"));
  const license = await raw(repo, sha, "LICENSE");

  const byId = new Map();
  for (const t of list) {
    if (t.isUserDefined) continue;
    const e = byId.get(t.id) ?? {
      id: t.id,
      format: t.format,
      category: t.category,
      level: t.level,
      attribution: (t.settings ?? "").replace(/^Source:\s*/i, "") || null,
      title: {},
      description: {},
      prompt: {},
    };
    e.title[t.lang] = t.title;
    e.description[t.lang] = t.description;
    e.prompt[t.lang] = t.prompt;
    byId.set(t.id, e);
  }
  const templates = [...byId.values()].filter((t) => t.prompt.en || t.prompt.hu);
  await writeJson("packs/browser-plugin.json", {
    pack: {
      id: "browser-plugin",
      name: "Prompt Architect for NotebookLM",
      repo: `https://github.com/${repo}`,
      commit: sha,
      license: "MIT",
      copyright: license.split("\n").find((l) => l.startsWith("Copyright")) ?? "",
    },
    templates,
  });
  return { repo, sha, license, count: templates.length };
}

// ---------------------------------------------------------------------------
// DrMultivac/notebooklm-learner-pack — 29 asset slots + 6 audience lenses
// ---------------------------------------------------------------------------
const SECTION_ASSET = {
  Infographics: "infographic",
  "Slide Decks": "deck",
  "Audio Overviews": "audio",
  "Video Storyboards": "video",
  "Knowledge Tests": "quiz",
};

function parseSlots(md) {
  const slots = [];
  let asset = null;
  let cur = null;
  const flush = () => cur && slots.push({ ...cur, body: cur.body.join("\n").trim() });
  for (const line of md.split("\n")) {
    const sec = line.match(/^## (.+?)\s*(\(\d+\))?\s*$/);
    if (sec) {
      flush();
      cur = null;
      asset = SECTION_ASSET[sec[1].trim()] ?? null;
      continue;
    }
    const slot = line.match(/^### ([A-Z]{2}-\d{2}): (.+)$/);
    if (slot && asset) {
      flush();
      cur = { id: slot[1], title: slot[2].trim(), asset, body: [] };
      continue;
    }
    if (cur && line.trim() !== "---") cur.body.push(line);
  }
  flush();
  // Knowledge tests declare their NotebookLM target (Flashcards / Quiz).
  return slots.map((s) => {
    let target =
      { infographic: "infographic", deck: "slide_deck", audio: "audio", video: "video" }[s.asset] ??
      "quiz";
    if (s.asset === "quiz" && /NotebookLM target:\*\*\s*Flashcards/i.test(s.body)) target = "flashcards";
    return { ...s, target };
  });
}

function parseLenses(md) {
  const lenses = {};
  let cur = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^### (.+?)(\s*\(Default\))?\s*$/);
    if (h) {
      cur = h[1].trim().toLowerCase().replace(/\s+/g, "_");
      lenses[cur] = {};
      continue;
    }
    const b = line.match(/^- \*\*([^*]+):\*\*\s*"(.+)"\s*$/);
    if (cur && b) {
      const key = b[1].toLowerCase().startsWith("general") ? "general" : b[1].toLowerCase();
      lenses[cur][key] = b[2];
    }
    if (/^## /.test(line) && cur) cur = null;
  }
  return Object.fromEntries(Object.entries(lenses).filter(([, v]) => Object.keys(v).length));
}

async function importLearnerPack() {
  const repo = "DrMultivac/notebooklm-learner-pack";
  const sha = await headSha(repo);
  const slots = parseSlots(await raw(repo, sha, "references/prompt-architecture.md"));
  const lenses = parseLenses(await raw(repo, sha, "references/audience-lenses.md"));
  const license = await raw(repo, sha, "LICENSE");
  if (slots.length < 20 || Object.keys(lenses).length < 5) {
    throw new Error(`learner-pack parse looks wrong: ${slots.length} slots, ${Object.keys(lenses).length} lenses`);
  }
  await writeJson("packs/learner-pack.json", {
    pack: {
      id: "learner-pack",
      name: "NotebookLM Learner Pack",
      repo: `https://github.com/${repo}`,
      commit: sha,
      license: "MIT",
      copyright: license.split("\n").find((l) => l.startsWith("Copyright")) ?? "",
      defaultLens: "operator",
    },
    slots,
    lenses,
  });
  return { repo, sha, license, count: slots.length, lenses: Object.keys(lenses) };
}

// ---------------------------------------------------------------------------
// YamilAyma/notebooklm-prompt-styles — personal download only (no license)
// ---------------------------------------------------------------------------
async function downloadPromptStyles() {
  const repo = "YamilAyma/notebooklm-prompt-styles";
  const sha = await headSha(repo);
  const tree = await gh(`repos/${repo}/git/trees/${sha}?recursive=1`);
  const files = tree.tree.filter((e) => e.type === "blob" && /^styles\/[^/]+\.ya?ml$/.test(e.path));
  const dir = path.join(envPaths("notebooklm-mcp", { suffix: "" }).data, "prompt-packs", "notebooklm-prompt-styles");
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) {
    await fs.writeFile(path.join(dir, path.basename(f.path)), await raw(repo, sha, f.path), "utf8");
  }
  await fs.writeFile(
    path.join(dir, "pack.json"),
    JSON.stringify(
      {
        id: "prompt-styles",
        name: "NotebookLM Slide Styles (personal copy)",
        repo: `https://github.com/${repo}`,
        commit: sha,
        target: "slide_deck",
        note: "Downloaded for personal use. The repository grants no redistribution license.",
      },
      null,
      2
    )
  );
  return { repo, sha, dir, count: files.length };
}

async function writeJson(rel, data) {
  const file = path.join(OUT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 1) + "\n", "utf8");
}

const plugin = await importBrowserPlugin();
console.log(`browser-plugin: ${plugin.count} templates @ ${plugin.sha.slice(0, 7)}`);
const learner = await importLearnerPack();
console.log(`learner-pack: ${learner.count} slots, lenses ${learner.lenses.join(", ")} @ ${learner.sha.slice(0, 7)}`);

await fs.writeFile(
  path.join(OUT, "THIRD_PARTY_NOTICES.md"),
  [
    "# Third-party prompt packs",
    "",
    "The bundled prompt packs in `prompts/packs/` are generated by",
    "`scripts/import-prompt-packs.mjs` from the repositories below and are",
    "redistributed under their licenses. Individual templates keep their",
    "original attribution in the `attribution` field.",
    "",
    `## ${plugin.repo} (commit ${plugin.sha})`,
    "",
    "```",
    plugin.license.trim(),
    "```",
    "",
    `## ${learner.repo} (commit ${learner.sha})`,
    "",
    "```",
    learner.license.trim(),
    "```",
    "",
    "## Not bundled",
    "",
    "YamilAyma/notebooklm-prompt-styles has no license that grants redistribution.",
    "`node scripts/import-prompt-packs.mjs --styles` downloads it into the user's",
    "own data directory for personal use; nothing from it is part of this package.",
    "",
  ].join("\n"),
  "utf8"
);

if (process.argv.includes("--styles")) {
  const s = await downloadPromptStyles();
  console.log(`prompt-styles: ${s.count} styles → ${s.dir} (personal use, not bundled)`);
}
