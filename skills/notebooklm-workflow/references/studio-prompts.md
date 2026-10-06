# Studio outputs — prompts, options, export

Contents: [Before generating](#before-generating) · [Composing the prompt](#composing-the-prompt) ·
[Types](#types) · [Language](#language) · [Async flow](#async-flow) · [Export and
post-processing](#export-and-post-processing) · [Pitfalls](#pitfalls)

## Before generating

Studio generations are the most expensive actions in NotebookLM. Before each one:

1. **Purpose** — what will the user do with it (listen on a commute, present to a board,
   revise for an exam, publish)? That decides type, length and tone.
2. **Sources** — the vetted subset for this output (`sources`), not everything in the
   notebook. This is the strongest accuracy lever for every type, audio included.
3. **Audience and language** — who, what level, which language.
4. **Plan check with the user** for anything beyond a single output; `get_usage` before a
   batch; `generate_later: true` when the rolling window is nearly used (queued, ready
   within hours, does not count against the current window).

`ask_options: true` shows the user a form with the type's options pre-filled — use it when
they want to choose themselves.

## Composing the prompt

```
goal        what the output must achieve, for whom
audience    level and background (learner-pack lens: eli5, newbie, clinical, operator, finance, deep_dive)
structure   sections / slide count / episode arc / card style
style       tone, visual style, what to avoid
grounding   "Use only the selected sources; do not add outside facts."
language    if it differs from the account setting (or use the `language` option)
```

Start from a pack template — `list_prompt_templates` with `target` set to the type (`audio`,
`video`, `slide_deck`, `infographic`, `report`, `quiz`, `flashcards`, `data_table`):

- `learner-*` templates are scaffolds by purpose (rapid brief, teaching deck, decision tree,
  common-mistake quiz …); `get_prompt_template` needs `topic` and optionally `lens`.
- `pa-studio-*` templates are styles and formats (executive briefing, debate, technical RFC
  deck, editorial infographic …), some in more than one language (`lang`).

Fill or remove every placeholder, then pass the result as `prompt` (`custom_prompt` for
`generate_audio`). Keep it focused: one clear goal beats a list of ten wishes.

## Types

| Type | Good for | Key options | Starting templates |
|---|---|---|---|
| `audio` | listening review, commute, a first pass over a dense topic | `format`: `deep_dive`, `brief`, `critique`, `debate`; `length`: `short`/`default`/`long` | `learner-au-01…05`, `pa-studio-audio-*` |
| `video` | visual explainer, onboarding, social clip | `format`: `explainer`, `short`, `cinematic` (plan-dependent) | `learner-vd-01…04`, `pa-studio-video-*` |
| `slide_deck` | presenting, teaching, briefing | `format`: `detailed` (reads standalone) / `presenter` (speaker support); `length` | `learner-sd-01…05`, `pa-studio-slide-deck-*` |
| `infographic` | one-page overview, comparison, process | `orientation`, `detail` (`concise`/`standard`/`detailed`), `style` (`professional`, `sketch_note`, `editorial`, `instructional`, `scientific` …) | `learner-ig-01…10`, `pa-studio-infographic-*` |
| `report` | briefing doc, study guide, blog post, own format — see [reports.md](reports.md) | `template`: `briefing_doc`, `study_guide`, `blog_post`, `create_your_own` (prompt required), `learning_overview` (interactive); `title`; `sources` with document templates | `suggest_reports`, `pa-studio-report-*` |
| `quiz` | self-testing | `count`, `difficulty` | `learner-qz-03…05`, `pa-studio-quiz-*` |
| `flashcards` | spaced repetition, terminology | `count`, `difficulty`, `include_images` | `learner-qz-01…02`, `pa-studio-flashcards-*` |
| `data_table` | structured comparison, evidence matrix | — | `pa-studio-data-table-*` |
| `mind_map` | structure of a topic, orientation | — | — |

Format choices that matter:

- **Audio `debate`** surfaces counter-arguments — good before writing an argument.
  **`critique`** gives an expert review of the material itself. **`brief`** for a fast recap.
- **Slides `presenter`** keeps slides sparse for a speaker; **`detailed`** when the deck is
  sent around and read without a speaker.
- **Report `create_your_own`** with a precise prompt is the most controllable text output
  (e.g. an evidence summary with a fixed section structure) — see [reports.md](reports.md).

## Language

The account's output language applies unless the call sets `language` — a language code
(`ja`, `de`, `pt-BR` …), the name NotebookLM lists (`日本語`, `Deutsch`) or the English name
(`Japanese`). Every type except `video` accepts `language`; for
audio use `generate_studio_artifact` with `type: "audio"` when you need it. Known gap: slide
titles may stay English although the content follows the requested language — check and
tell the user.

## Async flow

```
generate_studio_artifact → returns at once (with artifactId for audio/video/infographic/slides)
… continue other work: questions, the next phase …
list_studio_artifacts → poll about once a minute until the item is "ready"
download_studio_artifact { artifact_id, destination_dir } → file path
```

Audio and video typically take several minutes; slides and infographics a few minutes;
reports, quizzes, flashcards and tables are faster. `scheduled` means queued via
"Generate later". Do not start the same generation twice while one is running.

## Export and post-processing

`download_studio_artifact` saves: audio `.m4a`, video `.mp4`, infographic `.png`, slides
`.pdf` (or `.pptx` with `format: "pptx"`), report `.md`, data table `.csv`, quiz and
flashcards `.md` (or `.json` with `format: "json"`), mind map `.json`.

- **Flashcards → Anki / spaced repetition**: download with `format: "json"`, then run
  `node scripts/to-anki.mjs <file.json>` (bundled with this skill; Node 18+). It writes a
  tab-separated file Anki imports as "Basic" notes (front, back), and handles quiz JSON as
  question → correct answer (+ hint).
- **Quiz as live practice**: instead of handing over the file, quiz the user from the JSON
  one question at a time and track weak topics — retrieval practice beats rereading.
- **Data table** → CSV for a spreadsheet or for an evidence matrix in the report.
- **Slides** → PPTX for editing; check titles' language and the facts on dense slides.

## Pitfalls

- **Audio and video overviews are not citable.** Hosts can add background knowledge that is
  not in the sources and simplify. Use them for orientation and review.
- **Everything selected goes in.** An unvetted source in the selection ends up in the
  podcast — pass `sources`.
- **Vague prompts produce generic output** and a costly redo; long wish lists produce
  muddled output. One goal, one audience, one structure.
- **Several outputs at once** compete for the same budget — generate the one the user needs
  first, check it, then the next.
- **A failed or empty generation**: check `list_studio_artifacts`; retry once later or with
  `generate_later`, do not loop.
