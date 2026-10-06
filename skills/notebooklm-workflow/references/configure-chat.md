# Configure Chat — the notebook's system prompt

Contents: [How it works](#how-it-works) · [Save and restore](#save-and-restore) ·
[Phase → persona](#phase--persona) · [Writing the prompt](#writing-the-prompt) ·
[Adapting a template](#adapting-a-template) · [Examples](#examples) ·
[When not to configure](#when-not-to-configure)

## How it works

`configure_chat` sets NotebookLM's *Configure Chat*: a `goal` (`default`, `learning_guide`,
`custom`), a `custom_prompt` (up to 10 000 characters) and a `response_length` (`default`,
`longer`, `shorter`). It acts as the system prompt for **every** answer in that notebook —
through this server, in the web app and for anyone the notebook is shared with — until it
is changed. A stale persona is a common reason for oddly styled answers.

## Save and restore

1. `configure_chat` with no arguments → note `goal`, `customPrompt`, `length`.
2. Tell the user in one line that you are switching the notebook's chat persona for this
   phase and will restore it.
3. Set the phase prompt.
4. When the phase or the task ends (or before you hand the notebook back), set the saved
   values again — `goal: "default"` if it was default. Confirm with a read.

If the user asks you to keep a persona permanently, do so and say it stays.

## Phase → persona

Templates (`get_prompt_template`; pass `lang` when the pack has the user's language,
otherwise adapt the English text):

| Phase | Goal of the phase | Template |
|---|---|---|
| Vet sources | claims, credibility, bias, contradictions | `pa-configure-chat-fact-checker` |
| First overview, newcomer | plain explanations, analogies | `pa-configure-chat-eli5-explainer` |
| Understand in depth | structured, rigorous teaching | `pa-configure-chat-university-professor` |
| Analyse evidence | methods, evidence quality, gaps | `pa-configure-chat-research-scientist` |
| Test an argument | counter-arguments, steelmanning | `pa-configure-chat-debate-partner` |
| Numbers, tables | quantitative reading, comparisons | `pa-configure-chat-data-analyst` |
| Technical design | architecture, trade-offs | `pa-configure-chat-technical-architect` |
| Strategy, decisions | options, risks, recommendations | `pa-configure-chat-business-strategist` |
| Practise (understanding) | guided questions, no spoilers | `pa-configure-chat-socratic-tutor` or `goal: "learning_guide"` |
| Practise (exam) | active recall, scoring, weak spots | `pa-configure-chat-exam-coach` |
| Language learning | target-language practice, corrections | `pa-configure-chat-language-tutor` |
| Write, create | voice, style, continuity | `pa-configure-chat-creative-writer` |

No template fits? Write one with the structure below.

## Writing the prompt

Rules (the bundled templates follow them; keep them when adapting):

1. **GROUNDING first.** Start with the block the templates use: answer from this notebook's
   sources, every claim traceable, never fill gaps from outside knowledge, say plainly when
   the sources do not cover something. Without it a persona drifts into general knowledge.
2. **Role → Instructions → Steps → End goal → Narrowing** (RISEN): who the model is, what
   it does for every request, how, what success looks like, and the limits.
3. **Concrete output format**: structure, length, citation habit (e.g. "cite every claim;
   mark claims supported by only one source"), and what to end with (open questions, next
   step, a check question).
4. **Audience and level**: who reads the answers and what they already know.
5. **Language**: work in the user's language. "Answer in [the user's language]" fixes the
   answer language for this notebook even if the account setting is Default (English). The
   prompt itself may be written in that language too.
6. **Fill every [SLOT]** with real values from the conversation; never leave brackets in.
7. **No task in the system prompt**: the persona describes *how* to answer; the questions
   come through `ask_question`.
8. **≤ 10 000 characters**, ideally 1 500–4 000. Cut generic advice before cutting the
   grounding, format or narrowing.

## Adapting a template

1. `get_prompt_template` with the name, `lang`, and `context` describing the situation (it
   fills [BRACKETED] placeholders).
2. Read the text and adjust: audience and level, the user's goal and deadline, answer
   language, response length, domain vocabulary, what to emphasise or avoid.
3. Add situation-specific narrowing — e.g. for a course: "treat the lecture notes as the
   authority; when another source disagrees, say so"; for a story bible: "the canon notes
   override drafts".
4. `configure_chat` with `custom_prompt` (and `response_length` if it matters).
5. Ask one short test question and look at the answer before running the real work.

## Examples

**Exam practice, first-year student, answers in the student's language**

```
GROUNDING — applies to every answer in this notebook:
Work only from this notebook's sources; every claim must be traceable to them. Never fill
gaps with outside knowledge, and say plainly when the sources do not cover a question.

ROLE: Exam coach for a first-year BSc student (Microeconomics I).
METHOD: Active recall — ask first, explain only after the student answers. One concept per
question; for a wrong answer, show which source passage contradicts it.
FORMAT: Answer in [the student's language]. Short question → student's answer → verdict
(correct / partly / wrong) + a 2–3 sentence explanation with a citation. After every five
questions: score and weak topics.
NARROWING: The lecture slides are the authority; flag where the textbook differs. Never
reveal answers in advance.
```

**Literature analysis, English**

```
GROUNDING — applies to every answer in this notebook: […template block…]

ROLE: Research methodologist reviewing empirical studies on remote-work productivity.
INSTRUCTIONS: For every question, separate findings by study design (RCT, quasi-
experimental, observational, survey). Report effect sizes and samples when the sources give
them. Distinguish what a study measured from how the authors interpret it.
FORMAT: Bullet findings with citations; a "strength of evidence" line (strong / mixed /
weak) per answer; end with the open questions the sources do not resolve.
NARROWING: Never generalise beyond the populations studied. Flag claims made by a single
study. No outside knowledge.
```

**Hobby — story-bible continuity editor**

```
GROUNDING — […]
ROLE: Continuity editor for the user's fantasy series.
INSTRUCTIONS: The canon notes are the authority, then published chapters, then drafts.
When asked about a character, place or event, give the canon facts with citations, then
list every contradiction you find between sources (who says what, where).
FORMAT: Short answer first, then "Contradictions" and "Not established in canon".
NARROWING: Do not invent lore. Suggestions only when asked, and labelled as suggestions.
```

## When not to configure

- One question with special format needs → put the instructions in the question itself.
- A shared notebook other people use → ask before changing its persona.
- Quick lookups during another phase → keep the current persona; switching back and forth
  costs calls and confuses the user.
