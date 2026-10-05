# Research — academic, thesis, journalism, market and policy research

The trap: fluent, cited synthesis over a weak or one-sided corpus. Here source criticism is
the job, not a preliminary — use the strict bar in `source-criticism.md` throughout.

## Set-up

- **Organise by phase or chapter, not by vague theme**: e.g. `RQ1 – corpus`, `Chapter 2 –
  methods`, or raw corpus → analysis → outputs. NotebookLM cannot search across notebooks;
  keep each focused and use the cross-notebook pattern from SKILL.md when needed.
- **Corpus building**: start from the user's reading list and known key papers; add by your
  own targeted search (full texts, open-access versions) or `research_sources` with precise
  queries. Deep Research only for a deliberate broad survey — and vet every candidate.
- **Full texts only**: abstracts and repository landing pages make NotebookLM confidently
  wrong about methods and results. Check `words` and `get_source` text.
- **Register with full references** from the start (authors, year, title, venue, DOI/URL):
  NotebookLM citations are notebook positions, not bibliography entries.

## Phases

| Phase | Persona | Tools / outputs | Note |
|---|---|---|---|
| Scope | `research-scientist` | questions on definitions and the research question | Agree inclusion criteria with the user |
| Corpus + vetting | `fact-checker` | `research_sources` → vet → `import_research_sources`; `source-relevance-ranker`; `get_source` | Strict; record every exclusion reason |
| Mapping | `research-scientist` | mind map; data table (`pa-studio-data-table-research-findings`, `comparative-analysis`) | Evidence matrix: study, design, sample, finding |
| Analysis | `research-scientist`, `data-analyst` | `source-conflict-detector`; `multi-source-comparison-table`; questions per claim | Separate measured results from interpretation |
| Critique | `debate-partner` | `pa-critical-analysis-the-devils-advocate`, `the-anti-thesis`; audio `debate`/`critique` | Find the strongest counter-evidence |
| Writing support | default or `research-scientist` | report `create_your_own` with your section structure; `save_answer_as_note` | Draft from verified notes only |
| Verification | `fact-checker` | claim-by-claim check against citations | Every key claim traced to a primary source |

## Rules for claims

- Quote the original study, not a paper citing it (trace claims).
- Mark claims supported by a single source; report disagreement explicitly.
- Keep NotebookLM's wording out of the final text unless checked against the source passage.
- Do not convert unverified answers into sources (`convert_note_to_source`) — it launders
  AI text into "evidence".
- Sensitive topics (violence, crime, health) can trip safety filters: rephrase neutrally; if
  refused, tell the user rather than retrying.

## Journalism and market research specifics

- Primary documents (filings, court records, statistics, official statements) over coverage.
- Dates matter: note publication dates in the register; web sources are snapshots.
- Competitor material is marketing: use for what they *claim*, not for facts about them.
