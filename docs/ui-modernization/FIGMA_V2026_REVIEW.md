# Figma V2026 review checkpoint

Status: **VERIFY — owner visual/workflow review pending** (updated 2026-11-04).

[Open the design index](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=106-17244).
The original Equipment Handover Flow page retains all 23 original frames.
The new editable content is in the twelve `V2026` pages.

Source reference: pilot workspace `058014b52e5dee4f2b21af49fa02c56b9cc53c8f`.
This is a Figma artifact, not a frontend implementation or release.

## Coverage

| Family                                          | UI frames |
| ----------------------------------------------- | --------: |
| Skills overview/calendar/detail                 |         4 |
| Create, equipment registration, import          |         9 |
| Class management                                |         4 |
| Room management                                 |         6 |
| Basic Medical                                   |         7 |
| Administration/catalogs                         |        11 |
| Inventory and asset workflows                   |        30 |
| Preparation, adjustment, handover, multi-return |        10 |
| Authentication and shared feedback              |        11 |
| Representative responsive views                 |        20 |
| **Total**                                       |   **112** |

All 33 destinations in the admin sidebar superset have matching screens.
The staff-specific Basic Medical room-equipment view is represented by QT-08.
The file also contains a cover and component review board, separate from the
112 UI frames: 78 main components, 6 component sets, 64 variables, 11 text
styles and one effect style.

## Evidence

- Structural read-back of all 112 roots: no unintended local overflow or
  overlapping screen roots; intentional table scrolling/sidebar clipping is
  excluded from that assertion.
- 7,572 editable text nodes across those roots;
  all inspected text uses Be Vietnam Pro.
- Raster fills use only the source EIU logo and campus image. Complete UI
  screenshots are not embedded as the screen deliverables.
- Rendered review covered the main page families, canonical drawers, import,
  stock/receiving, multi-return, authentication and representative phone/tablet
  views. This is not runtime keyboard, accessibility or database verification.
- Prototype connections illustrate selected import, adjustment/multi-return,
  authentication, language and feedback paths. Other actions remain design examples.

## Workflow skill refinement — 2026-11-04

Applied the explicitly requested `workflow-app-ui` skill to the existing
editable design. Shared text/controls, bounded list scrolling and pagination,
drawer/form actions, source-correct Personnel checkboxes and the 42-cell month
calendar were corrected. Six new phone views cover loading, pending return,
saved receipt, Personnel, first use and failed list load. All 19 phone examples
have no horizontal scroll container. Structural checks found no functional
text below 14px or recognized phone input values below 16px.

Current evidence supersedes the October snapshots for the affected design:
[workflow review](FIGMA_WORKFLOW_APP_UI_2026-11-04.md) and
`D:/Orca/MedLabs-Figma-Workflow-2026-11-04/VERIFICATION-CURRENT.json`.
Final representative screenshots are in that evidence folder. Static Figma
inspection does not establish runtime focus, ARIA, touch or responsive-browser
correctness. Status remains VERIFY pending owner visual acceptance.

## Approved polish — 2026-10-30

The owner approved the polish proposal, asked for labels under three words and
no horizontal scrolling in mobile mode. The Figma now uses concise labels,
unit suffixes and a distinct calculated quantity, stronger current-return
emphasis, compact scalar fields, two daily shortcuts, pinned desktop catalog
identity and vertical mobile stock records. The Basic Medical phone form
retains all four groups, session details, notes and cancellation.

New narrow review frames: [R-13 VI](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=140-729)
and [R-14 EN](https://www.figma.com/design/xfaJx1sRn1bgMl5qfCPr1h?node-id=140-796),
both 320px. The 13 phone examples contain no horizontal scroll viewport;
navigation scrolls vertically and its 33 route targets are 44px high.
Full business names, codes and necessary explanations are preserved.

Impeccable polish/clarify/adapt guidance was read at upstream revision
`02523aec3e4c4580102d996d1b6a71fbe062e03f`. The temporary tools checkout is
outside the project; no project hook or dependency was installed. This is a
Figma review, so browser keyboard/ARIA, physical touch, performance and the web
source detector are not claimed as tested.

The October polish evidence superseded the initial 28 October snapshot:
`D:/Orca/MedLabs-Figma-2026-10-28/POLISH-VERIFICATION-FINAL.json`,
`POLISH-LIBRARY-FINAL.json` and `04-POLISH-IMPLEMENTED-2026-10-30.md`.

External evidence and the separate proposed-design backlog:
`D:/Orca/MedLabs-Figma-2026-10-28/00-SCREEN-COVERAGE.md`,
`01-DESIGN-CHANGES-AND-IMPLEMENTATION.md` and final verification JSON/images in
that folder. This checkpoint does not advance INV-OPS-V1 or APP-I18N acceptance.

## Next action

Review GN-01–10 first, especially GN-05/06 incremental return and GN-07
supplemental issue, then Inventory and the other sidebar groups. Record owner
feedback against screen IDs before implementing any design changes on pilot.
Update the UI Master first if an accepted proposal changes a canonical rule.
No application code, database, secrets, authorization or deployment changed.
