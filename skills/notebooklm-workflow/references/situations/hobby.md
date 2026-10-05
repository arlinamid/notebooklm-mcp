# Hobby — writing, worldbuilding, games, cooking, DIY, collections

Here the user's own material is usually the authority ("canon"), and NotebookLM is a memory
and consistency engine. Vetting is lighter, but two things still matter: facts that affect
safety, health or money, and copyright.

## Creative writing and worldbuilding

- **Sources**: story bible / canon notes, published chapters, drafts, maps described in text,
  timelines. Mark which is canon: titles like `CANON – characters`, `DRAFT – ch12`.
- **Persona**: continuity editor (example in `configure-chat.md`) or `creative-writer` when
  drafting with the user's voice.
- **Uses**:
  - continuity checks — "every description of [character]'s appearance, with sources; list contradictions";
  - timeline reconstruction — data table of events with chapter citations;
  - character sheets and glossary — report `create_your_own`;
  - brainstorming grounded in canon — ideas labelled as suggestions, never written into canon
    sources without the user's say-so;
  - audio overview of a draft as a "reader's impression".
- **Do not** convert AI suggestions into sources (`convert_note_to_source`) unless the user
  adopts them as canon — they would start overriding the real canon.
- **The user's own manuscripts in Drive**: find them with `research_sources`
  (`corpus: "drive"`, title keywords). Their own work is fine; pirated books found next to
  them are not — say so.

## Tabletop and video games

- Rulebooks the user owns (PDF; tables may be lost — paste key tables as text), campaign
  notes, session logs.
- Rules questions with page citations; session recap as audio `brief` for players; NPC and
  location indices as data tables. Keep rules (authority) and campaign notes (canon)
  distinguishable by title.

## Cooking

- The user's recipe collection and favourite cooking videos (YouTube transcripts).
- "What can I make with these ingredients — what is missing?"; scaling, substitutions, a
  weekly plan from *their* recipes.
- Food safety (temperatures, preservation, allergies) is a fact question: check against
  reputable food-safety sources, not a blog.

## DIY, repair, home lab, gardening

- Manuals and datasheets lose diagrams and tables in PDFs — keep the original open for
  figures; paste wiring tables or part lists as text.
- Safety-relevant steps (mains electricity, gas, structural work, chemicals): cite the
  manual; when the sources are unclear, say so and recommend a professional.

## Collections, genealogy, local history

- Archives, scans (OCR first), family documents, interviews.
- Timelines and people indices as data tables; mark uncertain identifications explicitly.
- Personal data of living people stays private — ask before uploading.

## Lighter vetting, still

- Own canon: no vetting needed, but keep canon and drafts apart.
- External facts the hobby depends on (history for a period novel, game rules, safety):
  moderate bar from `source-criticism.md`.
- Copyright: no pirated books, scraped paid content or shared paid courses.
