# Figma workflow review — 2026-11-04

Status: **VERIFY — owner visual acceptance pending**.

Applied the explicitly requested
`C:/Users/User/.codex/skills/workflow-app-ui/SKILL.md` and its workflow patterns
reference. The UI Master remains the canonical visual authority. This batch
changes editable Figma layers and review documentation; application source,
database, permissions and deployment are unchanged.

[Design index](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=106-17244).
Source reference: `codex/pilot-deep-review-20261028` at
`058014b52e5dee4f2b21af49fa02c56b9cc53c8f`. Existing unrelated dirty work was
preserved. No branch switch, commit, push or deployment was performed.

## Findings and applied corrections

| Finding                                                         | Applied correction                                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional labels/metadata at 12–13px; phone fields at 14px     | Shared functional floor 14px, phone input/search/select values 16px, readable line height. Keep Be Vietnam Pro.                                                       |
| Field boundaries too similar to light dividers                  | Semantic control-border #8A8174; cards/table dividers retain their lighter token. Focus/error retain current colors.                                                  |
| Long record pages move filters and pagination offscreen         | Bounded record regions in 23 dedicated desktop list views; header/filter and shared pagination stay outside record scroll. Table headers separated where appropriate. |
| Phone lists/forms grow past the working viewport                | Vertically scrolling content with visible filters/pagination or form actions. No horizontal phone scroll.                                                             |
| Personnel drawer too tall and dismissal not always available    | Bounded 600×900 drawer, visible close header, independent body scroll and stable actions. Calendar drawer/file preview/dirty guard also fitted.                       |
| Personnel roles and permissions represented as free-text fields | Source-backed checkbox choices, exclusive Viewer, conditional Basic Medical capability, scope and active state; matching desktop/phone field order.                   |
| Month layout had 35 cells and event overflow                    | Source-matched 42 cells, taller cells preserve readable event details.                                                                                                |
| Empty, filtered-zero and failed-load feedback can be confused   | Distinct first-use, filtered-zero, loading and load-error examples. Unknown count uses “Chưa tải”; known empty uses “0 kết quả”.                                      |
| Submission/receipt feedback insufficiently illustrated          | Pending return keeps draft visible and actions disabled; saved receipt keeps actual facts/remaining obligation and dismissible success feedback.                      |
| Dismissal wording can imply destructive cancellation            | Use Đóng/Quay lại for dismissal; retain distinct destructive cancellation where relevant. Required stars use red.                                                     |

Preserved EIU blue/gold/cream, VI default with EN switch, labels at most two
words and the ≤920px prohibition on horizontal scrolling. Full business names,
data and useful explanatory sentences remain intact. Desktop wide catalogs
retain local horizontal scrolling and pinned identity as previously approved.
Selected filters and operational status badges retain distinct roles; pending
return is warning, overdue remains danger.

## Source alignment

- `components/personnel-management-list.tsx`: current role toggling supports
  multiple non-viewer roles and exclusive Viewer; import/email/Basic Medical
  capabilities and room scope have eligibility rules. Figma now uses checkbox
  representations matching those controls. Existing fixture is still staff
  Trần Bình, with Nursing scope and import capability. No access is granted.
- `app/class-schedules/page.tsx:168` and
  `app/basic-medical/schedules/page.tsx:240`: month grids use 42 cells.
- Closing versus business cancellation remains distinct; the prototype does
  not implement authentication, server validation or database transitions.

## Review targets

| Target                 | Figma                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| Personnel desktop      | [QT-02](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=95-3521)  |
| Personnel phone        | [R-18](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=184-850)   |
| Operational phone list | [R-05](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=102-143)   |
| Month calendar         | [SK-03](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=89-2074)  |
| File preview           | [QT-11](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=95-6035)  |
| Loading                | [R-15](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=184-649)   |
| Pending return         | [R-16](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=184-717)   |
| Saved receipt, 320px   | [R-17](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=184-774)   |
| First use              | [R-19](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=200-724)   |
| Load error             | [R-20](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=200-788)   |
| Shared components      | [Board](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=114-1091) |

## Verification evidence

External evidence directory:
`D:/Orca/MedLabs-Figma-Workflow-2026-11-04/`.
`VERIFICATION-CURRENT.json` is the definitive final structural result;
`VERIFICATION-FINAL.json` is an earlier 110-frame snapshot. Mutation ledgers,
source surveys and final PNGs are retained alongside it.

- **RUN AND PASS** — structural read-back of 112 UI roots, including 19 phone
  examples and one tablet, with 7,572 editable text nodes: zero unintended
  bounds issues, overlapping roots, functional text below 14px, recognized
  phone field/search/select values below 16px, or mobile horizontal scrollers.
  Deliberate vertical viewport clipping and approved desktop table scrolling
  are excluded from unintended overflow checks.
- **RUN AND PASS** — library inspection: 78 main components, six component
  sets, 64 variables, 11 text styles, one effect style; no variable with missing
  web code syntax or unrestricted ALL_SCOPES. Original page loaded explicitly;
  all 23 original frames preserved.
- **RUN AND PASS** — representative rendered inspection, including final
  Personnel desktop/phone, phone worklist, saved return at 320px, first-use and
  load-error views, file preview, month calendar and component board. Earlier
  batch renders also cover Basic Medical form actions and VI/EN return views.
- **RUN AND PASS** — selected token contrast calculations: control border
  against white 3.84:1 and readonly background 3.41:1; sampled text/status pairs
  range from 4.55:1 to 13.16:1. This is limited token-pair evidence, not a full
  WCAG audit or certification.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT** — application build/tests,
  database checks and React performance audit: no application/schema/runtime
  code changed.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT** — browser keyboard/focus,
  ARIA, gestures, zoom and real-device runtime checks. Static Figma geometry
  does not establish those behaviors; verify during frontend implementation.

Prototype links illustrate selected paths only. They are not a complete
interactive app, role/locale permutation matrix or backend workflow test.
Pagination totals represent the fixture records; they do not mandate a
production page size. No production acceptance gate is advanced by this work.

## Handoff

Documentation hygiene: **RUN AND PASS** — Prettier check on the seven
task-owned Markdown files and `git diff --check`. Existing architecture review
files were left untouched.

Review the linked desktop and phone views, then record owner feedback against
screen IDs. Keep FIGMA-V2026 at VERIFY until explicit visual acceptance. Any
subsequent frontend implementation must follow the UI Master, preserve source
business/security contracts, and run its own rendered/runtime regression.
