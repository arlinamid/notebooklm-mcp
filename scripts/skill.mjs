#!/usr/bin/env node
/**
 * Agent skill tooling for skills/<name>/ (Agent Skills format, agentskills.io).
 * Ships in the npm package, so users run it as
 * `npx @arlinamid/notebooklm-mcp skill <command>`; in the repository as
 * `node scripts/skill.mjs <command>` (or the npm scripts skill:*).
 *
 *   install [--agent a,b] [--force] [--dry-run]   copy the skill into agent skill folders
 *   zip [--out dir]                               Claude app upload ZIP (Settings → Capabilities)
 *   path                                          print the bundled skill folder
 *   validate                                      check skills + plugin manifests (repository)
 *
 * install targets (user scope):
 *   claude  ~/.claude/skills   Claude Code (Cursor reads it too)
 *   agents  ~/.agents/skills   Codex, Gemini CLI, Cursor (vendor-neutral)
 *   copilot ~/.copilot/skills  GitHub Copilot
 * Default: claude + agents. Claude Desktop / claude.ai: upload the ZIP, or add
 * this repository as a plugin marketplace. Others: `npx skills add arlinamid/notebooklm-mcp`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "skills");
const CLAUDE_APP_DESCRIPTION_MAX = 200;
const TARGETS = {
  claude: path.join(os.homedir(), ".claude", "skills"),
  agents: path.join(os.homedir(), ".agents", "skills"),
  copilot: path.join(os.homedir(), ".copilot", "skills"),
};

// ---------------------------------------------------------------------------
// Frontmatter (the YAML subset SKILL.md uses: scalars, `>-` folded blocks, one-level maps)

function parseFrontmatter(text) {
  const m = text.replace(/\r/g, "").match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("SKILL.md must start with YAML frontmatter between --- lines");
  const lines = m[1].split("\n");
  const indent = (l) => l.search(/\S/);
  const scalar = (v) => v.trim().replace(/^(["'])(.*)\1$/, "$2");
  const block = (start, base) => {
    const out = [];
    let i = start;
    for (; i < lines.length && (lines[i].trim() === "" || indent(lines[i]) > base); i++) {
      out.push(lines[i].trim());
    }
    return { value: out.join(" ").replace(/\s+/g, " ").trim(), next: i };
  };
  const parse = (start, base) => {
    const obj = {};
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") { i++; continue; }
      if (indent(line) < base) break;
      const kv = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv) throw new Error(`Cannot parse frontmatter line: ${line}`);
      const [, key, rest] = kv;
      if (rest === ">-" || rest === ">" || rest === "|") {
        const b = block(i + 1, indent(line));
        obj[key] = b.value;
        i = b.next;
      } else if (rest === "") {
        const child = parse(i + 1, indent(line) + 1);
        obj[key] = child.obj;
        i = child.next;
      } else {
        obj[key] = scalar(rest);
        i++;
      }
    }
    return { obj, next: i };
  };
  return { data: parse(0, 0).obj, raw: m[0], body: text.replace(/\r/g, "").slice(m[0].length) };
}

// ---------------------------------------------------------------------------

function skillDirs() {
  return fs
    .readdirSync(SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS, d.name, "SKILL.md")))
    .map((d) => path.join(SKILLS, d.name));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function validateSkill(dir, errors, warnings) {
  const name = path.basename(dir);
  const where = `skills/${name}`;
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  let fm;
  try {
    fm = parseFrontmatter(text);
  } catch (e) {
    errors.push(`${where}: ${e.message}`);
    return;
  }
  const { data, body } = fm;
  const n = data.name ?? "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n) || n.length > 64)
    errors.push(`${where}: name "${n}" must be 1-64 chars of a-z, 0-9 and single hyphens`);
  if (n !== name) errors.push(`${where}: name "${n}" must match the directory name`);
  const d = data.description ?? "";
  if (!d || d.length > 1024) errors.push(`${where}: description must be 1-1024 chars (has ${d.length})`);
  if (data.compatibility !== undefined && (data.compatibility.length < 1 || data.compatibility.length > 500))
    errors.push(`${where}: compatibility must be 1-500 chars`);
  if (data.metadata !== undefined) {
    if (typeof data.metadata !== "object") errors.push(`${where}: metadata must be a map`);
    else
      for (const [k, v] of Object.entries(data.metadata))
        if (typeof v !== "string") errors.push(`${where}: metadata.${k} must be a string`);
  }
  const short = data.metadata?.["short-description"] ?? (d.length <= CLAUDE_APP_DESCRIPTION_MAX ? d : "");
  if (!short || short.length > CLAUDE_APP_DESCRIPTION_MAX)
    errors.push(
      `${where}: Claude apps allow ${CLAUDE_APP_DESCRIPTION_MAX}-char descriptions — set metadata.short-description`
    );
  const known = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const k of Object.keys(data)) if (!known.has(k)) warnings.push(`${where}: unknown frontmatter field "${k}"`);
  const lines = body.split("\n").length;
  if (lines > 500) warnings.push(`${where}: SKILL.md body has ${lines} lines (keep under 500)`);
  // Relative links in every Markdown file must resolve inside the skill.
  for (const file of walk(dir).filter((f) => f.endsWith(".md"))) {
    const md = fs.readFileSync(file, "utf8");
    for (const [, target] of md.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!resolved.startsWith(dir)) errors.push(`${path.relative(ROOT, file)}: link leaves the skill: ${target}`);
      else if (!fs.existsSync(resolved)) errors.push(`${path.relative(ROOT, file)}: broken link ${target}`);
    }
  }
  return { name, data };
}

function validateManifests(errors) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const json = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
      return null;
    }
  };
  for (const rel of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
    const m = json(rel);
    if (m && m.version !== version) errors.push(`${rel}: version ${m.version} ≠ package.json ${version}`);
  }
  json(".claude-plugin/marketplace.json");
  json(".agents/plugins/marketplace.json");
  const mcp = json("mcp.json");
  if (mcp && !mcp.mcpServers?.notebooklm) errors.push("mcp.json: mcpServers.notebooklm is missing");
}

function validate({ quiet = false, manifests = true } = {}) {
  const errors = [];
  const warnings = [];
  const skills = skillDirs().map((d) => validateSkill(d, errors, warnings)).filter(Boolean);
  if (manifests) validateManifests(errors);
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`✖ ${e}`);
    process.exit(1);
  }
  if (!quiet) console.log(`✔ ${skills.length} skill(s) and plugin manifests valid: ${skills.map((s) => s.name).join(", ")}`);
  return skills;
}

// ---------------------------------------------------------------------------
// ZIP (stored entries; no dependencies)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(file, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, deflated);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(deflated.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, centralBuf, end]));
}

/** SKILL.md with the description replaced by the short one (Claude apps' 200-char limit). */
function claudeAppSkillMd(dir, data) {
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8").replace(/\r/g, "");
  const short = data.metadata?.["short-description"] ?? data.description;
  return text.replace(
    /^description:[^\n]*\n((?:[ \t]+[^\n]*\n)*)/m,
    `description: ${JSON.stringify(short)}\n`
  );
}

function zip(args) {
  const outDir = path.resolve(args.out ?? path.join(ROOT, "dist-skills"));
  fs.mkdirSync(outDir, { recursive: true });
  for (const { name, data } of validate({ quiet: true, manifests: false })) {
    const dir = path.join(SKILLS, name);
    const entries = walk(dir).map((file) => {
      const rel = path.relative(dir, file).split(path.sep).join("/");
      const content = rel === "SKILL.md" ? Buffer.from(claudeAppSkillMd(dir, data), "utf8") : fs.readFileSync(file);
      return { name: `${name}/${rel}`, data: content };
    });
    const file = path.join(outDir, `${name}.zip`);
    writeZip(file, entries);
    console.log(`✔ ${path.relative(process.cwd(), file)} (${entries.length} files) — upload in Claude: Settings → Capabilities → Skills`);
  }
}

// ---------------------------------------------------------------------------

function install(args) {
  const wanted = (args.agent ?? "claude,agents").split(",").map((s) => s.trim()).filter(Boolean);
  for (const w of wanted) if (!TARGETS[w]) throw new Error(`Unknown agent "${w}" — use ${Object.keys(TARGETS).join(", ")}`);
  for (const { name } of validate({ quiet: true, manifests: false })) {
    const src = path.join(SKILLS, name);
    for (const w of wanted) {
      const dest = path.join(TARGETS[w], name);
      if (fs.existsSync(dest) && !args.force) {
        console.log(`• ${w}: ${dest} exists — pass --force to replace it`);
        continue;
      }
      if (args["dry-run"]) {
        console.log(`• ${w}: would copy ${name} → ${dest}`);
        continue;
      }
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      console.log(`✔ ${w}: ${name} → ${dest}`);
    }
  }
}

// ---------------------------------------------------------------------------

const USAGE = `Usage: skill <command>
  install [--agent claude,agents,copilot] [--force] [--dry-run]
          claude  ~/.claude/skills   Claude Code
          agents  ~/.agents/skills   Codex, Gemini CLI, Cursor
          copilot ~/.copilot/skills  GitHub Copilot
          (default: claude,agents)
  zip [--out dir]   ZIP for Claude Desktop / claude.ai (Settings → Capabilities → Skills)
  path              print the bundled skill folder
  validate          check skills and plugin manifests (repository)`;

/** Run a skill command; argv without the leading "skill". Returns the exit code. */
export function runSkillCli(argv) {
  const [cmd, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    const m = rest[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] !== undefined) args[m[1]] = m[2];
    else if (rest[i + 1] && !rest[i + 1].startsWith("--")) args[m[1]] = rest[++i];
    else args[m[1]] = true;
  }
  try {
    if (cmd === "validate") validate();
    else if (cmd === "zip") zip(args);
    else if (cmd === "install") install(args);
    else if (cmd === "path") for (const d of skillDirs()) console.log(d);
    else {
      console.log(USAGE);
      return cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0;
    }
    return 0;
  } catch (error) {
    console.error(`✖ ${error.message}`);
    return 1;
  }
}

// Direct run: node scripts/skill.mjs <command>
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runSkillCli(process.argv.slice(2)));
}
