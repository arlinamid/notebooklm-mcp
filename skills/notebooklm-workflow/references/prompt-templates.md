# Prompt templates in the notebooklm MCP server

Contents: [What is there](#what-is-there) · [Two ways in](#two-ways-in) · [Find](#find) ·
[Get](#get) · [Use](#use) · [Quick picks by phase](#quick-picks-by-phase) · [No fitting template](#no-fitting-template)

## What is there

The server ships curated, MIT-licensed prompt packs and loads the user's own:

| Pack | `pack` | What it holds |
|---|---|---|
| Prompt Architect for NotebookLM | `browser-plugin` | chat questions (analysis, critique, synthesis, source management), Configure Chat personas, Studio prompts and visual styles; several in more than one language |
| NotebookLM Learner Pack | `learner-pack` | purpose scaffolds for Studio outputs (rapid brief, teaching deck, decision tree, common-mistake quiz …) composed from a `topic` and an audience `lens` |
| The user's packs | their pack id | anything in `NOTEBOOKLM_PROMPT_DIRS` or `<data dir>/prompt-packs/` (JSON, Markdown or YAML templates) — prefer these when they fit, the user put them there on purpose |

Every template has a **target** — the action it is written for:
`ask` · `configure_chat` · `audio` · `video` · `slide_deck` · `infographic` · `report` · `quiz` ·
`flashcards` · `data_table` · `mind_map`.

## Two ways in

- **Tools** (for the agent): `list_prompt_templates` to search, `get_prompt_template` to fetch
  one. Nothing runs in NotebookLM until you call the target tool yourself.
- **MCP prompts** (for the user): clients that show MCP prompts list the same templates as
  prompts / slash commands. If the user picked one there, its message already names the tool
  to call — still apply the steps under [Use](#use).

## Find

`list_prompt_templates` — filters combine; results come in pages:

| Argument | Use |
|---|---|
| `target` | the action you are about to take — always set it |
| `query` | keywords matched against name, title, description, category: `"debate"`, `"executive"`, `"glossary"`, `"fact check"`, `"beginner"` |
| `pack` | `learner-pack`, `browser-plugin` or a user pack |
| `lang` | only templates available in this language (e.g. the user's language) |
| `limit` / `offset` | page size (default 20, max 100) and paging; `total` tells how many matched |

Each hit has `name`, `title`, `target`, `pack`, `langs`, `description` and, when present,
`level` and `category`. Shortlist two or three by description; for the user's choice, show
titles and one-line descriptions rather than names.

## Get

`get_prompt_template`:

| Argument | Use |
|---|---|
| `name` | from the search (folded duplicates' names work too) |
| `lang` | the user's language if the template has it (`langs`), else omit |
| `context` | facts that fill the template's `[BRACKETED]` placeholders: audience, domain, goal, constraints |
| `topic` | **required** for learner-pack templates — the subject of the output |
| `lens` | learner-pack audience: `eli5`, `newbie`, `clinical`, `operator`, `finance`, `deep_dive` |
| `notebook` | a library id or notebook URL, named in the instructions |

It returns `text` (the template itself), `instructions` (a ready user message that names the
tool and argument to use), plus `source` and `license`.

## Use

1. **Read `text`, then adapt it** to the situation: audience and level, the user's goal,
   required structure and length, answer language. Fill every `[PLACEHOLDER]` with real
   values; never send brackets to NotebookLM. Keep the template's grounding block and
   structure — that is what makes it work.
2. **Call the target tool yourself** with the adapted text:

| Target | Tool and argument |
|---|---|
| `ask` | `ask_question` → `question` (+ `sources`, `source_format`) |
| `configure_chat` | `configure_chat` → `custom_prompt` — read and save the current setting first, restore later ([configure-chat.md](configure-chat.md)) |
| `audio` | `generate_audio` → `custom_prompt` (+ `sources`, `format`, `length`) |
| `report` | `generate_studio_artifact` → `prompt`, `type: "report"`, `template: "create_your_own"` (+ `sources`, `title`) |
| other Studio types | `generate_studio_artifact` → `prompt`, `type` = the target (+ `sources` and type options) |

3. **Always add `sources`** — the vetted sources this question or output is about. The
   template says *how*; the source selection decides *from what*.
4. **Language**: most templates are in English. The output language comes from the account
   setting, the `language` option of Studio tools, or an "Answer in …" line in a Configure
   Chat prompt — not from the template's language.

## Quick picks by phase

| Phase | Target | Start with |
|---|---|---|
| Vet sources | `ask` | `pa-source-management-source-relevance-ranker`, `pa-source-management-source-conflict-detector` |
| Vet sources | `configure_chat` | `pa-configure-chat-fact-checker` |
| Understand | `configure_chat` | `pa-configure-chat-eli5-explainer`, `pa-configure-chat-university-professor` |
| Synthesise | `ask` | `pa-source-management-global-synthesis-compact`, `pa-advanced-techniques-multi-source-comparison-table` |
| Critique | `ask` | `pa-critical-analysis-the-devils-advocate`, `pa-critical-analysis-the-anti-thesis` |
| Practise | `configure_chat` / `quiz` / `flashcards` | `pa-configure-chat-exam-coach`, `learner-qz-03-common-mistake-quiz`, `pa-studio-flashcards-exam-prep-flashcards` |
| Gaps | `ask` | `pa-troubleshooting-source-based-gap-analysis-engine` |
| Report | `report` | `suggest_reports` first (source-derived), then `pa-studio-report-executive-briefing` and the other `pa-studio-report-*` |
| Present | `slide_deck` | `learner-sd-01…05` by purpose, `pa-studio-slide-deck-*` for visual style |
| Listen | `audio` | `learner-au-01…05` by length and arc, `pa-studio-audio-debate-opposing-views` |

Names can change between versions — search by `target` and `query` when a name is not found.

## No fitting template

Write the prompt yourself with the same conventions: grounding first ("use only the selected
sources; say when they are silent"), then role or purpose, structure, length, evidence and
citation rules, audience and exclusions. For reports see [reports.md](reports.md), for chat
personas [configure-chat.md](configure-chat.md).
