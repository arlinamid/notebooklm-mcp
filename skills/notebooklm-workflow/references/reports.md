# Reports — NotebookLM's most useful output

Contents: [Why reports](#why-reports) · [Scope first](#scope-first) · [Pick a format](#pick-a-format) ·
[Suggested templates](#suggested-templates) · [Writing a custom report prompt](#writing-a-custom-report-prompt) ·
[Examples](#examples) · [Iterate and deliver](#iterate-and-deliver)

## Why reports

A report is a structured document written from the sources, with citations, that you can
download as Markdown and reuse: a briefing, a study guide, an evidence summary, a glossary, a
cheat sheet, a decision memo, a style guide. It is cheaper and more controllable than audio or
video, easier to verify (it is text), and with a precise prompt it follows a structure exactly.
When the user wants "something I can read, share or build on", a report is usually the answer.

## Scope first

The single biggest lever on accuracy is **which sources the report is written from**. A
notebook usually mixes core sources, background material and things that turned out weak; a
report over all of them blends them. So:

- Decide the subset from the source register: the vetted sources that are *about this report's
  question*. Three to ten focused sources beat thirty loosely related ones.
- Pass them as `sources` to `suggest_reports` and to `generate_studio_artifact`. Reports take
  `sources` with the document templates (`briefing_doc`, `study_guide`, `blog_post`,
  `create_your_own`); the interactive `learning_overview` uses whatever is checked in the
  notebook, so prefer a document template when the subset matters.
- Separate reports per angle (e.g. one per competitor, one per chapter, one per policy area)
  rather than one report over everything — then a synthesis report over the vetted outputs if
  needed.

## Pick a format

| Template | Gives | Use for |
|---|---|---|
| `briefing_doc` | executive summary, key themes, quotes with context, actionable insights | getting someone up to speed fast |
| `study_guide` | key concepts, short-answer questions, essay prompts, glossary | learning and exam preparation |
| `blog_post` | readable article with intro, sections and takeaways | sharing with a general audience |
| `create_your_own` | exactly the structure, tone and length you specify | everything else — the most useful one |
| `learning_overview` (interactive) | report with embedded Studio elements | browsing a topic; no source subset |

`prompt` with a built-in template is appended to its own instructions (focus, audience,
language); with `create_your_own` the prompt is the whole instruction. `title` names the
report; `language` sets its language (default: the account's output language).

## Suggested templates

The generic templates are a starting point; NotebookLM also proposes **suggested formats
derived from the sources** — e.g. a technical analysis for engineering documents, a
character study for a manuscript, a compliance guide for regulations, a glossary for a
dense textbook. They often hit the most useful angle for the material.

`suggest_reports` with the planned `sources` returns four suggestions — title, description,
audience (`general` / `expert`) and a ready-made `prompt` — plus the notebook summary and
suggested questions. Then:

1. Show the user the suggestions (with audience), next to the generic templates.
2. Take the chosen suggestion's `prompt` and adapt it: the user's audience and purpose,
   required sections, length, language, citation habit.
3. Generate with `type: "report"`, `template: "create_your_own"`, the adapted `prompt`, the
   suggestion's `title` and the same `sources`.

Suggestions are written in the notebook's language; the report language still follows
`language` or the account setting.

## Writing a custom report prompt

The more specific the prompt, the closer the result — vague prompts produce generic
summaries, long wish lists produce muddled ones. Cover:

```
Purpose      what the reader will do with it
Audience     who reads it, prior knowledge, register (expert / general)
Structure    exact sections in order, with what goes in each; tables where comparisons help
Length       per section or total (e.g. "max 2 pages", "5–7 bullets per section")
Evidence     cite every factual claim; quote key passages; mark single-source claims;
             state where the sources disagree or are silent
Tone         neutral / persuasive / instructional; no marketing language
Language     if it differs from the account setting
Exclusions   what not to include (speculation, outside knowledge, background already known)
```

A style or brand guide uploaded as a source can be referenced ("follow the attached style
guide for structure and tone") — include it in `sources`.

## Examples

**Evidence summary (research)**

```
Write an evidence summary on [question] for a policy analyst.
Sections: 1. Bottom line (3 sentences). 2. Evidence table: study, design, sample, finding,
strength (strong/mixed/weak). 3. Where the studies agree. 4. Where they conflict and why.
5. Gaps — what the sources do not answer. Cite every claim; mark findings supported by only
one study. No outside knowledge. Max 1,500 words.
```

**Cheat sheet (learning, technical)**

```
Create a one-page cheat sheet on [topic] for a beginner who has read the material once.
Sections with headings: core concepts (one line each), syntax / formulas with a minimal
example each, common mistakes and how to avoid them, a 5-question self-check with answers at
the end. Use tables where it saves space. Cite the source of every example.
```

**Decision memo (work)**

```
Write a decision memo for the leadership team on [decision].
Sections: context (max 5 bullets), options (table: option, benefits, costs, risks, evidence),
recommendation with the two strongest reasons, open risks and how to monitor them, next steps
with owners if the sources name them. Every number must be cited; flag numbers that appear in
only one document.
```

**Continuity bible (hobby, creative)**

```
Compile a character reference for [series] from the canon notes and published chapters only.
For each character: name, role, physical description, relationships, key events by chapter.
End with "Contradictions" (who says what, where) and "Not established in canon".
```

## Iterate and deliver

- Read the result before handing it over: structure followed? Claims cited? Anything from
  outside the selected sources?
- Refine with a narrower prompt rather than regenerating the same one; each generation costs
  usage.
- `download_studio_artifact` saves the report as Markdown — ready to edit, convert or paste.
  NotebookLM's citations are notebook positions; add real references from the source register
  when the report leaves the notebook.
- A verified report can become a source for later work (`convert_note_to_source` is for notes;
  for a report, add the downloaded Markdown with `add_source` `type: "text"`) — only after
  checking it.
