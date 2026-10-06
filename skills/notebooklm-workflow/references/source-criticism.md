# Source criticism for NotebookLM

Contents: [Why](#why) · [Triage](#triage-list_sources) · [Inspect](#inspect-get_source) ·
[Judge](#judge-sift--craap) · [Red flags](#red-flags) · [Adding sources](#adding-sources) ·
[Research queries](#research-queries) · [Vetting candidates](#vetting-research-candidates) ·
[In-notebook checks](#in-notebook-checks) · [Strictness](#strictness-by-situation) ·
[Register](#the-source-register)

## Why

Everything NotebookLM produces is grounded in the notebook's sources — including their
errors, gaps and bias. A citation proves only that a passage exists in the notebook, not
that it is true, current or authoritative. Garbage in still comes out *with citations*,
which makes it more convincing, not less.

Vet before every phase, because "good enough" depends on the use: a popular-science
article is fine for a first overview and wrong as evidence in a thesis chapter.

## Triage (`list_sources`)

One call gives every source's `type`, `url`/`channel`, `words`, `characters`, `status`,
`origin` and `addedAt`. Flag for inspection:

| Signal | Likely cause |
|---|---|
| `status: failed` | NotebookLM could not read it — re-add another way |
| web / pdf / doc with < 500 `words` | landing page, abstract, paywall, cookie or login wall, a repository record instead of the paper |
| `origin: research` not yet in your register | came from NotebookLM's own search, never vetted |
| a domain you would not cite (see red flags) | weak or unreliable publisher |
| YouTube with a tiny word count | transcript missing or auto-generated fragments |
| two sources with the same title or URL | duplicate — answers over-weight it |
| title unrelated to the task | noise that dilutes retrieval |
| old `addedAt` on a fast-moving topic | snapshot is stale (web, PDF and YouTube sources never update) |

## Inspect (`get_source`)

- `guide.summary` / `guide.keywords` — what NotebookLM thinks the source is about. A
  mismatch with the title is a warning sign.
- `include_text: true, max_chars: 2500` — the opening of the *indexed* text. Look for: the
  actual body text (not menus, cookie notices, "Sign in to continue", reference lists only);
  author, publisher, date; whether it is the full document. Page further with `offset` /
  `nextOffset` only when needed.
- For a long source you will quote from, sample the middle as well — a PDF can be complete
  at the start and garbled later (scanned pages, tables turned into soup).

## Judge (SIFT + CRAAP)

**SIFT** (fast, for every source): **S**top — do you know this publisher? **I**nvestigate the
source — who is behind it, what is their interest? **F**ind better coverage — is there a
primary or more authoritative version? **T**race claims to the original — quote the study,
not the article about the study.

**CRAAP** (for sources that carry key claims):

| | Question | Typical fail |
|---|---|---|
| Currency | Is it current for this topic? | 2019 article on a 2026 regulation |
| Relevance | Does it address *this* question at the right depth? | encyclopedia overview for a technical detail |
| Authority | Who wrote / published it, with what expertise? | anonymous blog, vendor marketing |
| Accuracy | Is it evidenced, referenced, consistent with others? | claims without sources, numbers that do not add up |
| Purpose | Inform, sell, persuade, entertain? | product page, advocacy piece presented as neutral |

Prefer **primary** sources (the law, the standard, the paper, the dataset, the
manufacturer's manual, the meeting transcript) over **secondary** ones (news, summaries,
blog posts), and secondary over **tertiary** (encyclopedias, listicles).

## Red flags

- Content farms, SEO listicles, "top 10" pages, AI-generated filler with no author or date.
- Vendor and marketing pages used as evidence about the vendor's own product.
- Scribd, Course Hero, PDF-sharing and "free ebook" sites: often pirated, often partial,
  often the wrong edition. Pirated copies — tell the user; do not import them silently, also
  not when they turn up in the user's own Drive.
- Forums, Q&A sites, social media — fine as *leads* or for lived experience, not as evidence.
- Wikipedia — fine for orientation and for finding primary sources; cite what it cites.
- ResearchGate figure pages, repository landing pages, abstracts — find the full text.
- Press releases and award pages — date and scope facts only.
- Machine-translated pages, mirrors, scraped copies — go to the original.

## Adding sources

Order of preference:

1. **What the user gives you** — their files, notes, course material, links.
2. **What you curate yourself** — your own web search and page fetching cost no NotebookLM
   quota and let you read before adding. Add the vetted URLs with `add_source`
   (`type: "url"`, several per call) or paste text (`type: "text"`, with a `title`).
3. **NotebookLM's own search** (`research_sources`) — useful for Drive search and for a broad
   first survey; always followed by vetting (below).

Ingestion limits and fixes:

| Limit | Fix |
|---|---|
| URL: only visible text; paywalled articles do not work | find the open-access version (author's page, arXiv, PubMed Central, institutional repository) |
| URL: a repository record imports only the landing page | link the PDF itself |
| YouTube: public videos with transcript only | for others, use a transcript the user has, as text |
| Scanned PDF: imports "fine" but answers say it is not in the sources | OCR it first, upload the text |
| Tables, formulas, figures lost from PDFs | paste the key tables as Markdown text sources; describe essential figures in text |
| Huge documents: retrieval gets vague | split by chapter; one focused source answers better than one 500-page blob |
| Source cap per notebook (50 on the free plan) | merge small related texts into one text source; split the project into notebooks by phase or theme |

## Research queries

Every `research_sources` run spends AI usage; Deep Research much more. NotebookLM returns
what the query asks for — a vague query brings popular, loosely related pages. One precise
query instead of three loose ones:

**Formula:** subject + specific aspect + kind of source + timeframe/version + region/language.

| Too loose | Precise |
|---|---|
| `AI Act` | `EU AI Act Article 6 high-risk classification — official EU texts and Commission guidelines 2024-2026` |
| `heat pump` | `air-to-water heat pump winter efficiency (COP) in cold continental climates — independent measurements and standards since 2022` |
| `sleep and memory` | `sleep spindles and declarative memory consolidation — peer-reviewed reviews and meta-analyses since 2020` |
| `sourdough` | `sourdough starter hydration and fermentation temperature — food science sources, not recipe blogs` |

Drive (`corpus: "drive"`, fast only): use words from the files' titles or content — two or
three distinctive keywords work better than a sentence (`Q3 board minutes`, `thesis draft chapter`).

Mode: `fast` (≈10 candidates in seconds) for a targeted lookup; `deep` (minutes, dozens of
pages + a report) only for a broad survey the user asked for. The same query again is
answered from the notebook's research history at no cost — never re-run with cosmetic
rewording. A `failed` run found nothing: rephrase with different terms.

## Vetting research candidates

For each candidate you consider: read `title`, `description`, the URL's domain and — for deep
runs — `passage` and whether it is `cited`. When that is not enough, open the URL yourself.
Then decide:

- `high` — primary or authoritative, current, directly on the question.
- `medium` — credible secondary source, or primary but partial / slightly dated.
- leave it out — anything from the red-flag list, off-topic, duplicate, or unverifiable.

`import_research_sources` needs `reliability` and a concrete `reason` per selection, e.g.
*"City transport authority — the project owner's official page; primary for scope, dates
and costs."* Generic
reasons ("looks relevant") help no one later. Check each returned `warning` with
`get_source` and replace landing pages with full text.

Deep Research's report is a synthesis of mixed-quality pages: treat it as a map of what to
look at, not as a source. Do not paste it into the notebook as a source.

## In-notebook checks

Once sources are in, let NotebookLM help — on the vetted subset (`sources`):

- `pa-source-management-source-relevance-ranker` — rank sources by relevance to the question.
- `pa-source-management-source-conflict-detector` — where sources contradict each other.
- Configure Chat with `pa-configure-chat-fact-checker` for a dedicated vetting phase
  (claim extraction, CRAAP per source, bias, cross-referencing, verdicts).
- Ask: *"Which claims in [topic] rest on a single source? List claim, source, and whether
  any other source confirms or contradicts it."*

Fetch templates with `get_prompt_template` and run them with `ask_question`.

## Strictness by situation

| Situation | Bar | Notes |
|---|---|---|
| Research, journalism, legal, medical, financial | strict — primary or peer-reviewed for key claims; every claim traceable | report single-source claims; record full references |
| Work decisions | strict on facts and figures; internal documents are primary | check document versions and dates; confidentiality first |
| Learning a course | the course material is the authority; outside sources only to clarify | flag where outside sources disagree with the course |
| Self-directed learning | moderate — reputable textbooks, official docs, recognised experts | avoid learning from a single blog |
| Hobby and creative | lenient — your own canon is the truth; external facts still checked when they matter (safety, health, law) | copyright: no pirated material |

## The source register

Keep it in your replies (and in a file for multi-session projects):

```
| # | Source (id) | Type · words | Verdict | Reason | Phases |
|---|---|---|---|---|---|
| 1 | Ministry guidance on X, 2025 (3cc7…) | pdf · 12 400 | ✅ high | official, current, primary | overview, report |
| 2 | University repository record (9a1f…) | web · 460 | ⚠️ | landing page only — add the PDF | — |
| 3 | Vendor blog "10 facts about X" (51be…) | web · 1 900 | ❌ | marketing, no sources | — |
```

Use it to pick the `sources` subset for each phase, and to build real references at the end.
