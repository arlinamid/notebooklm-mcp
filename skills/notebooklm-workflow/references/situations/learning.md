# Learning — courses, exams, new skills, languages

The trap: NotebookLM makes reading *about* the material effortless, and passive summaries
feel like learning. Retention comes from retrieving, explaining and applying. Use NotebookLM
to organise the material and then to make the learner work.

## Set-up

- **One notebook per course or exam unit** (or per skill). Name it like the exam.
- **Sources**: the official material first — lecture slides, notes, recordings or their
  transcripts (YouTube lectures import as transcripts), readings, problem sets with
  solutions, the syllabus. Clear file names: they become the citation labels.
- **Authority**: in a course, the course material defines what is "right" for the exam.
  Outside sources only to clarify — and flag where they disagree with the course.
- **Self-directed learning**: pick 5–15 strong sources (official docs, a reputable textbook,
  recognised experts) over 50 random pages. Vet them (`source-criticism.md`, moderate bar).
- **Language**: check the output language; podcasts in the learner's language help, or in
  the *target* language for language learning.

## Phases

| Phase | Persona (Configure Chat) | Tools / outputs | Note |
|---|---|---|---|
| Orientation | `eli5-explainer` or `university-professor` (by level) | mind map; `report` `study_guide`; short `brief` audio | Map the territory before details |
| Understanding | `university-professor`, or `goal: "learning_guide"` | specific questions; `pa-learning-concept-connection-mapper`; infographic for processes | Ask "explain X using an example from lecture 3" |
| Practice | `socratic-tutor` (understanding) or `exam-coach` (exam) | quiz, flashcards → Anki (`scripts/to-anki.mjs`); open-ended quiz | Quiz the user yourself from the JSON; track weak topics |
| Gap repair | `exam-coach` | `pa-troubleshooting-source-based-gap-analysis-engine`; targeted questions on weak topics | Use the user's wrong answers as input |
| Review | — | audio `brief` or `debate` on weak topics; one-page infographic | Short and focused, not the whole course |

## Good questions

- "List the three causes of X as presented across my sources, one supporting line each."
- "Give me a worked example of Y from problem set 2, step by step, then a similar problem
  without the solution."
- "What do lectures 4 and 6 say differently about Z?"
- "Ask me five questions on topic T, one at a time; wait for my answer."

## Language learning

- Sources in the target language (articles, transcripts, graded readers) plus the course
  book; persona `language-tutor` with the learner's level (A2, B1 …) and native language.
- Audio overview in the target language as listening practice (set `language`).
- Flashcards for vocabulary from the user's own texts; export to Anki.

## Pitfalls

- Summaries instead of practice — always end a session with retrieval.
- Too many sources — answers get vague; split into units.
- Outside "better" explanations contradicting the lecturer — the exam follows the lecturer.
- Podcast as the only review — it can simplify or add outside facts; check key points.
