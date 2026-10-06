---
name: notebooklm-workflow
description: >-
  Run real work through Google NotebookLM (Gemini Notebook) with the notebooklm MCP tools:
  studying, research, professional and hobby projects. Covers source criticism before every
  phase (vetting uploaded and NotebookLM-discovered sources, Fast/Deep Research without wasting
  quota), phase-specific Configure Chat prompts, Studio prompts (audio/video overview, slides,
  infographic, report, quiz, flashcards, data table), output language, quota-aware questions,
  cross-notebook synthesis and answer verification. Use whenever the user mentions NotebookLM,
  Gemini Notebook, notebook sources, audio overview, study guide, flashcards or literature
  review, in any language, or when notebooklm tools are available and the task involves
  documents, learning or research.
compatibility: >-
  Needs the notebooklm MCP server (npm @arlinamid/notebooklm-mcp, 3.3.0 or later) connected to
  the agent and signed in to a Google account. Works with any agent that loads Agent Skills.
license: MIT (see LICENSE)
metadata:
  author: János Rózsavölgyi (arlinamid)
  version: "1.0.0"
  homepage: https://github.com/arlinamid/notebooklm-mcp/tree/main/skills/notebooklm-workflow
  repository: https://github.com/arlinamid/notebooklm-mcp
  issues: https://github.com/arlinamid/notebooklm-mcp/issues
  mcp-server: "@arlinamid/notebooklm-mcp"
  mcp-server-min-version: "3.3.0"
  tags: notebooklm, gemini-notebook, research, source-criticism, learning, reports, studio, mcp
  short-description: >-
    Source-vetted NotebookLM workflows for learning, research, work and hobbies: source
    criticism, phase prompts, Studio outputs, quota and language care.
---

# NotebookLM workflows

NotebookLM answers from the sources in a notebook, with citations. That makes it strong at
grounded synthesis and weak wherever the sources are weak: its answers, podcasts and slides
are exactly as good as what went in. Everything in this skill follows from four facts:

1. **Source quality decides the outcome** — and NotebookLM's own source discovery often
   brings weak material (encyclopedias, blogs, marketing, landing pages, pirated copies).
2. **Every AI action spends a compute budget** that refills every 5 hours up to a weekly
   cap. Cost grows with prompt complexity, chat length and feature (Studio and Deep Research
   cost the most). Vague requests waste it twice: once on the bad run, once on the redo.
3. **Which sources a generation uses decides its accuracy.** Every answer and every Studio
   output can be limited to chosen sources (`sources`). A few vetted sources that are about the
   question give precise, cited results; the whole notebook gives a blend of core material,
   background and weak leftovers. Choose the subset for *each* question and output.
4. **The notebook's chat configuration is a persistent system prompt** that shapes every
   answer — so it should match the current phase of work, and be restored afterwards.

Tool names below are the notebooklm MCP server's tool names; clients may show them with a
prefix (e.g. `mcp__notebooklm__ask_question`).

## Orient first (cheap calls)

- `get_health` — if not authenticated, `setup_auth` (the user logs in once in a browser).
- Find the notebook: `list_notebooks` / `search_notebooks`; an empty library →
  `import_account_notebooks` with `dry_run: true`, then import what the user picks.
- `get_usage` before anything heavy (research runs, several Studio outputs, long Q&A).
  Tell the user if the rolling window is above ~70 %.
- `configure_output_language` (read only) when the user works in a language other than
  English. "Default" means English answers and English podcasts. Setting it is
  account-wide (also changes the web app) — ask first; for a single Studio output pass
  `language` instead.
- Understand the situation: goal, audience, deliverable, depth, deadline. Ask one short
  round of questions only if this is unclear, then pick the matching playbook:

| Situation | Playbook | Gist |
|---|---|---|
| Learning — course, exam, new skill, language | [situations/learning.md](references/situations/learning.md) | Course material is the authority; active recall over summaries |
| Research — academic, journalism, thesis, market | [situations/research.md](references/situations/research.md) | Strict vetting, claim-level verification, real citations |
| Work — meetings, policies, contracts, reports | [situations/work.md](references/situations/work.md) | Confidentiality, decisions and owners, presentable output |
| Hobby — writing, worldbuilding, recipes, DIY, games | [situations/hobby.md](references/situations/hobby.md) | Your own canon; consistency checks; lighter vetting |

## The loop

Plan the work as phases (e.g. collect → vet → understand → analyse → practise or produce →
review). Then, for **each** phase:

```
source gate → configure chat → work → verify → produce → restore
```

Not every phase needs every step, but the source gate is never skipped: a source that was
fine for an overview can be wrong for a quoted claim.

### 1. Source gate — highest priority

Read [references/source-criticism.md](references/source-criticism.md) the first time you vet
sources in a conversation; it has the checklists, red flags and query patterns.

- **Triage** with `list_sources`: `type`, `url`, `words`, `status`, `origin`. Suspicious:
  `failed`; web/PDF under ~500 words (landing page, abstract, paywall, cookie wall);
  `origin: research` not yet vetted; off-topic titles; duplicates.
- **Inspect** suspicious or new sources with `get_source`: the `guide` summary says what
  NotebookLM thinks it is; `include_text` (first ~2–3k chars) shows what answers are really
  grounded on. Ask: is this the document? who publishes it? when? primary or secondary? on
  topic for *this* phase?
- **Add sources deliberately.** Prefer what the user provides and what you curate yourself
  (your own web search and fetch cost no NotebookLM quota and let you read before adding).
  Use `research_sources` when NotebookLM's search adds value (Drive search, broad survey):
  one precise query, `fast` by default, `deep` only for a broad survey the user wants. It
  never imports — vet the candidates, then `import_research_sources` with `reliability` and
  a concrete `reason` per source. Check every returned `warning`.
- **Know the ingestion limits**: URLs import only visible text (no paywalled articles);
  YouTube only public videos with a transcript; scanned PDFs, tables, formulas and figures
  lose content. Fix before adding: find the open-access full text, OCR, or paste tables as
  Markdown text sources.
- **Scope every generation** — pass `sources` to `ask_question`, `generate_studio_artifact`
  (reports too, with document templates), `generate_audio` and `suggest_reports`: the vetted
  sources relevant to *that* question or output, typically 3–10. Excluding weak sources this
  way is better than deleting them (deleting needs the user's approval).
- **Keep a source register** (id · title · verdict ✅/⚠️/❌ · reason · used in phase) in
  your replies; write it to a file only for multi-session projects or when asked.

### 2. Configure chat for the phase

Read [references/configure-chat.md](references/configure-chat.md) before writing a system
prompt. In short:

- `configure_chat` with no arguments reads the current setting — **save it**. The setting is
  notebook-wide and persistent (web app and other sessions see it too); say so when you
  change it, and restore it when the phase or task ends.
- Pick the persona for the phase (e.g. fact-checker for vetting, university professor or
  ELI5 explainer for understanding, research scientist or debate partner for analysis,
  Socratic tutor or exam coach for practice, creative writer for production). Fetch the
  template with `get_prompt_template` (pass `lang` when the pack has the user's language) and
  **adapt** it to the situation: audience, level, language, output format, length.
- Keep the GROUNDING block first, fill every [SLOT], stay under 10 000 characters, and keep
  the actual question out of the system prompt.
- For a single one-off answer, skip the configuration and put the instructions in the
  question instead.

### 3. Ask well (quota-aware)

- Make questions specific and bundle related sub-questions into one request.
- Reuse `session_id` for follow-ups; `reset_session` when the topic changes (long chats
  cost more per answer and drift).
- Pass the `sources` that the question is about — comparing two documents? select those
  two. Use `source_format: "footnotes"` (or `json`) whenever claims will be reused.
- Check the answer against its citations: does the excerpt support the claim? Is a key
  claim backed by only one source? Do sources disagree? Report disagreement instead of
  smoothing it over.
- Useful ask templates (`list_prompt_templates` with `target: "ask"`):
  `pa-source-management-source-relevance-ranker`, `pa-source-management-source-conflict-detector`,
  `pa-advanced-techniques-multi-source-comparison-table`, `pa-critical-analysis-the-devils-advocate`.
- NotebookLM's failure reply or a safety-filter refusal is reported as an error: retry once
  later at most, then rephrase or tell the user — do not loop.

**Several notebooks** (NotebookLM cannot search across notebooks): ask the same precise
question in each relevant notebook, one after another (separate `session_id`s; never call
one session in parallel), then synthesise with the notebook named for every claim.

### 4. Studio outputs

Read [references/studio-prompts.md](references/studio-prompts.md) before generating. Studio
generations are the most expensive actions, so:

- Agree the plan with the user first: type, options, audience, language, which sources.
  Several outputs → `get_usage` first; a tight window → `generate_later: true`.
- Compose the prompt from **goal + audience + structure + style + grounding + language**,
  starting from a pack template (`list_prompt_templates` with the Studio `target`;
  learner-pack templates take `topic` and an audience `lens`).
- Always pass the vetted `sources` subset chosen for this output.
- **Reports** are the most useful output — structured, citable, downloadable text. Read
  [references/reports.md](references/reports.md): scope the sources, check NotebookLM's
  source-derived suggestions with `suggest_reports`, then write a precise `create_your_own`
  prompt.
- Generation is asynchronous: keep working (questions are fine meanwhile), poll
  `list_studio_artifacts` about once a minute, then `download_studio_artifact`.
- An Audio or Video Overview is a summary for listening, not a citable source — hosts can
  add background knowledge that is not in the sources.

### 5. Verify and deliver

- Separate what the sources say from your own inference, and label AI-generated text.
- NotebookLM citations point into the notebook, not to a bibliography: when the user needs
  references, build them from the source register (author/publisher, title, date, URL).
- `save_answer_as_note` keeps a valuable answer. Turn a note into a source
  (`convert_note_to_source`) only after verifying it — otherwise unverified AI text becomes
  "evidence" for later answers.

### 6. Restore and report

Restore `configure_chat`, `close_session`, and tell the user what changed in their account:
sources added or excluded, Studio items created, settings changed.

## Ask before

- changing the account's output language;
- uploading documents that may be confidential (a personal Google account is not an
  enterprise workspace; content is not used for training, but feedback can be reviewed);
- deleting sources, notes or Studio items (the tools ask for approval too);
- Deep Research runs and batches of Studio outputs (quota);
- importing material of doubtful origin (pirated books, scraped copies) — say what it is.

## References

- [references/source-criticism.md](references/source-criticism.md) — triage signals, SIFT/CRAAP
  checklist, red flags, research query patterns, strictness by situation, register format
- [references/configure-chat.md](references/configure-chat.md) — phase → persona map,
  prompt rules, adaptation recipe, save/restore, examples
- [references/reports.md](references/reports.md) — scoping, templates, suggested formats,
  custom report prompts with examples, iteration
- [references/studio-prompts.md](references/studio-prompts.md) — each Studio type: when,
  options, prompt recipe, templates, pitfalls, export and post-processing
- `references/situations/` — learning, research, work, hobby playbooks
