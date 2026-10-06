# Work — meetings, policies, contracts, reports, onboarding

The traps: confidential material in the wrong place, outdated document versions, and
polished output that hides an unverified number.

## Before uploading

- **Confidentiality**: ask before adding client data, personal data, contracts or internal
  financials to a personal Google account. Enterprise workspaces have different terms; the
  user decides. Prefer redacted or summarised versions when in doubt.
- **Versions**: name sources with version and date (`HR policy v3 – 2026-03`). Drop
  superseded versions from the selection, or answers mix old and new rules.
- **Google Docs/Sheets/Slides from Drive** stay in sync with Drive; uploaded files and web
  pages are snapshots — re-add after changes.

## Patterns

| Task | Sources | Persona | Output |
|---|---|---|---|
| Meeting follow-up | transcript, agenda, previous minutes | default or `business-strategist` | ask: decisions, action items with owners and deadlines, open questions (`pa-productivity-meeting-summary-generator`); report `briefing_doc` |
| Policy / handbook Q&A | the policy documents only | custom: "answer only from policy, cite section, say when it is not covered, no legal advice" | precise answers with section citations |
| Contract review | the contract + referenced annexes | custom: clause-finder | obligations, deadlines, termination, liability — each with clause citation; flag ambiguity; not legal advice |
| Competitive / market brief | vetted public sources, analyst reports | `business-strategist` | `pa-studio-report-competitive-intelligence`; data table comparison |
| Decision memo | options documents, data, constraints | `business-strategist`, then `debate-partner` | report `create_your_own` with options, risks, recommendation; audio `critique` for the team |
| Onboarding | docs, processes, FAQ | `university-professor` (newcomer level) | video explainer, slide deck `detailed`, quiz for self-check |
| Presentation | vetted subset | — | slide deck `presenter` + PPTX download; check every number on the slides |

## Rules

- Numbers and dates in outputs must be traceable to a cited source passage — verify before
  anything leaves the team.
- Keep a short register: document, version, owner, date.
- Recurring work (weekly report, monthly digest): keep one notebook per stream, refresh its
  sources, reuse the same Configure Chat prompt and Studio prompt so outputs stay comparable.
- For automation (n8n, Zapier) the server also runs over HTTP; keep the same vetting step
  in the flow.
