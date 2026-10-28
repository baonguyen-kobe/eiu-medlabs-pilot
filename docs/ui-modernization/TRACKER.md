# EIU MedLabs UI Modernization Tracker

This is the authoritative stable-ID task registry. Status definitions and Definition of Done are in `MASTER-PLAN.md`.

Rules:

- Never rename audit IDs.
- Never mark a cross-feature parent `DONE` until all non-deferred children are `DONE`.
- Normally, only one primary implementation batch is `IN_PROGRESS`.
- Every `BLOCKED` row states its blocker.
- `DONE` requires applicable verification evidence.

## 2026-10-28 pilot review continuity

This registry was inherited from the August UI foundation and is not a claim that the October pilot has the same implementation state. The current explicit task was an advisory deep workflow/Inventory/infrastructure/design review, not automatic AUTH-01 implementation. Review baseline: pilot `main@c42abf669222b81fadd2595d64de19c4a135ac2d`; local branch `codex/pilot-deep-review-20261028`.

External handoff: `D:/Orca/MedLabs-Deep-Review-2026-10-28/00-README.md`, with a separate design backlog. Local authenticated Inventory overview was rendered using synthetic seed data; this does not complete BASE-01's representative route/viewport matrix. No UI task status is advanced by this review. Restore/reconcile the missing `D:/Orca/medlabs-OPs` authority pack and accepted upstream UI families before planning implementation.

Follow-up user direction: finish the workflow plan before implementation, prioritizing quantity management, reusable multi-return, and sudden equipment-request changes. External `05-WORKFLOW-PRODUCT-PLAN.md` and DES-17–20 supplement the advisory review; no existing task is marked DONE or new product contract silently accepted.

## Primary task registry

Inventory follow-up batch `INV-OPS-V1`: VERIFY under explicit user authorization, 2026-10-28. Implementation is uncommitted on the pilot branch. Scope/checklist: `openspec/changes/inventory-operational-v1/`. Evidence: `D:/Orca/MedLabs-Deep-Review-2026-10-28/06-IMPLEMENTATION-HANDOFF.md` (build, audit, 140-migration replay, 36 pgTAP files / 943 tests, final Node checks and bounded browser observations). Owner visual/operational acceptance is pending. This does not advance historical UI task statuses or authorize production.

| ID          | Task                                                                    | Phase | Priority | Status  | Dependencies                                  | Scope                                                     | Verification/Evidence                                                                                                              |
| ----------- | ----------------------------------------------------------------------- | ----- | -------- | ------- | --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TRACK-01    | Persistent UI modernization tracking foundation                         | 0     | P0       | DONE    | None                                          | Documentation and agent continuity only                   | Audit archived hash-identically; foundation commit `507e08c869049f38882e7129ad47fb319df4ad50` pushed to writable fork `main`       |
| BASE-01     | Authenticated protected-screen rendered baseline                        | 0     | P0       | BLOCKED | Approved local authentication/environment     | Representative protected routes at required viewports     | Blocker: approved authenticated local environment is unavailable; do not manufacture credentials                                   |
| DEC-01      | Choose business-approved accessible signature/confirmation alternative  | 1     | P0       | BLOCKED | User/business decision                        | Equipment handover/return and Basic Medical confirmation  | Blocker: non-pointer business interaction has not been approved                                                                    |
| A11Y-01     | Replace pointer-only required signature interaction                     | 1     | P0       | BLOCKED | DEC-01                                        | Two signature/confirmation workflow families              | Audit evidence: pointer handlers only; implementation forbidden until DEC-01 is accepted                                           |
| AUTH-01     | Repair forgot/reset/change-password screens using approved login family | 1     | P1       | READY   | TRACK-01                                      | Three auth routes; no business/auth behavior changes      | Audit rendered `/forgot-password` failure at 375/1440 and `/reset-password` failure at 375; current `/login` is approved reference |
| A11Y-02     | Consolidate overlay focus, Escape, inert, and focus-return behavior     | 2     | P1       | BACKLOG | AUTH-01; BASE-01 where protected              | Shared overlay foundation plus five child families        | ConfirmDialog is accepted behavior reference                                                                                       |
| A11Y-03     | Complete SearchableCombobox keyboard model                              | 2     | P1       | BACKLOG | AUTH-01                                       | Seven consumers                                           | Arrow navigation, active option, announcement, focus and form behavior at four viewports                                           |
| A11Y-04     | Add accessible names to filters and repeated-row controls               | 2     | P1       | BACKLOG | AUTH-01                                       | Basic Medical equipment and Staff Shifts first            | Label/name inventory from audit; keyboard and screen-reader verification required                                                  |
| TABLE-01    | Add accessible TableScrollViewport contract                             | 2     | P1       | BACKLOG | AUTH-01                                       | Repeated responsive table wrappers                        | Named focusable region, local scroll, no page overflow, visual shell ownership                                                     |
| FORM-01     | Formalize field, description, error, and invalid relationships          | 2     | P2       | BACKLOG | AUTH-01                                       | Shared field foundation and gradual adoption              | `aria-invalid`, `aria-describedby`, first-error behavior where applicable                                                          |
| TOUCH-01    | Establish touch-target baseline for compact actions                     | 2     | P1       | BACKLOG | AUTH-01                                       | Staff-shift actions first; shared compact controls        | Audit found 24×28px staff-shift action targets; verify touch widths                                                                |
| PILOT-01    | Classes responsive/accessibility representative pilot                   | 3     | P1       | BACKLOG | A11Y-03; A11Y-04; TABLE-01; FORM-01; TOUCH-01 | `/classes/open`, `/classes/mine`, `ClassRegistrationList` | Must pass 375/768/1024/1440, keyboard, accessibility, pagination and identity checks                                               |
| MOB-01      | Assign and implement per-table mobile strategies                        | 3–5   | P1       | BACKLOG | TABLE-01; PILOT-01                            | Seven child families                                      | Parent stays open until all non-deferred children are DONE                                                                         |
| PERF-01     | Remove personnel page per-row request fan-out                           | 7     | P1       | BACKLOG | PILOT-01                                      | `/admin/personnel` server loading                         | Measure request count/latency; preserve security and result shape                                                                  |
| DS-01       | Consolidate semantic token generations safely                           | 6     | P1       | BACKLOG | BASE-01; PILOT-01                             | Global tokens only                                        | Computed-style and visual regression evidence required                                                                             |
| DS-02       | Incrementally reduce global CSS architecture debt                       | 6     | P1       | BACKLOG | DS-01; BASE-01; PILOT-01                      | Seven mandatory child batches                             | Never execute as one giant globals.css cleanup                                                                                     |
| ARCH-01     | Consolidate import wizard presentation shell                            | 5     | P2       | BACKLOG | PILOT-01                                      | Schedule and equipment import wizards                     | Preserve domain parsing, validation, permissions, five-step flow                                                                   |
| ARCH-02     | Extract demonstrated cohesive boundaries from large client components   | 7     | P2       | BACKLOG | PILOT-01; relevant rollout tasks              | Dashboard, shifts, request and registration components    | No line-count-only refactor; require behavior/performance evidence                                                                 |
| STATE-01    | Add route loading/error and recoverable async-state foundations         | 7     | P2       | BACKLOG | PILOT-01                                      | App Router states and shared UX                           | Preserve known environment failures as distinct blockers                                                                           |
| STATE-02    | Add lifecycle-history request failure state                             | 7     | P2       | BACKLOG | Shared async-state direction where applicable | Equipment lifecycle history                               | Must eliminate perpetual loading on a failed RPC                                                                                   |
| INT-01      | Resolve dead or misleading controls                                     | 5     | P2       | BACKLOG | AUTH-01 for remember-login decision           | Dashboard `Xem tất cả`; login remember control            | Each control must gain real behavior or be removed through explicit product decision                                               |
| TYPE-01     | Remove unsupported undersized content typography                        | 6     | P2       | BACKLOG | DS-01; PILOT-01                               | Legacy metadata and Staff Shifts                          | Preserve density; do not enlarge blindly                                                                                           |
| CONTRAST-01 | Correct demonstrated muted login contrast                               | 6     | P2       | BACKLOG | AUTH-01; DS-01                                | Login secondary copy                                      | Audit measured 4.28:1; verify rendered computed contrast                                                                           |
| Z-01        | Formalize overlay and sticky layering policy                            | 6–8   | P3       | BACKLOG | A11Y-02; DS-02.5                              | Sticky, popover, drawer, modal, toast                     | Verify no layer regressions on representative routes                                                                               |
| INT-02      | Add consistent pressed-state feedback                                   | 6–8   | P3       | BACKLOG | DS-01; PILOT-01                               | Shared buttons and toggles                                | Keyboard/touch/mouse behavior; no layout-shifting motion                                                                           |
| QA-01       | Final full-route viewport, keyboard, accessibility, and identity sweep  | 8     | P0       | BACKLOG | All non-deferred implementation tasks         | All 32 page routes                                        | `QA-MATRIX.md` complete with no invented PASS states                                                                               |

## Cross-feature child tasks

### A11Y-02 overlay families

| ID        | Task                                            | Phase | Priority | Status  | Dependencies     | Scope                     | Verification/Evidence                                          |
| --------- | ----------------------------------------------- | ----- | -------- | ------- | ---------------- | ------------------------- | -------------------------------------------------------------- |
| A11Y-02.1 | Mobile WorkspaceShell/sidebar focus contract    | 2     | P1       | BACKLOG | A11Y-02; BASE-01 | Mobile navigation         | Trap/inert, Escape, scrim close, focus return, 375/768         |
| A11Y-02.2 | Personnel drawer focus contract                 | 2–4   | P1       | BACKLOG | A11Y-02; BASE-01 | Personnel edit drawer     | Initial focus, trap, sticky regions, pending, close and return |
| A11Y-02.3 | Staff-shift dialog focus contract               | 2–4   | P1       | BACKLOG | A11Y-02; BASE-01 | Quick/edit dialogs        | Shared shell, field names, Escape, return, mobile fit          |
| A11Y-02.4 | Equipment modal focus contract                  | 2–4   | P1       | BACKLOG | A11Y-02; BASE-01 | Item and signature modals | Shared shell; signature behavior remains blocked by DEC-01     |
| A11Y-02.5 | Basic Medical confirmation modal focus contract | 2–4   | P1       | BACKLOG | A11Y-02; BASE-01 | Confirmation modal        | Shared shell; signature behavior remains blocked by DEC-01     |

### MOB-01 table families

| ID       | Task                                       | Phase | Priority | Status  | Dependencies                  | Scope                                                | Verification/Evidence                              |
| -------- | ------------------------------------------ | ----- | -------- | ------- | ----------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| MOB-01.1 | Classes pilot mobile column priority       | 3     | P1       | BACKLOG | PILOT-01                      | `/classes/open`, `/classes/mine`                     | Strategy B; keep action reachable; four viewports  |
| MOB-01.2 | Equipment request mobile strategy          | 4     | P1       | BACKLOG | PILOT-01; A11Y-02.4           | Request summary/detail and item editing              | Strategy D for list; C/F where editing requires it |
| MOB-01.3 | Basic Medical registration mobile strategy | 4     | P1       | BACKLOG | PILOT-01; A11Y-02.5           | Registration/session/condition tables                | Strategy D/F; preserve approved business layout    |
| MOB-01.4 | Basic Medical equipment mobile strategy    | 4     | P1       | BACKLOG | PILOT-01                      | Catalog, inventory, damaged, logs                    | Individual A/B/E choices; no universal conversion  |
| MOB-01.5 | Personnel mobile strategy                  | 4     | P1       | BACKLOG | PILOT-01; A11Y-02.2           | Personnel table/drawer                               | Strategy E; preserve desktop table reference       |
| MOB-01.6 | Staff shifts mobile strategy               | 4     | P1       | BACKLOG | PILOT-01; TOUCH-01; A11Y-02.3 | Calendar and registration rows                       | Touch, labels, local scroll, dialog fit            |
| MOB-01.7 | Remaining table-family mobile strategies   | 5     | P2       | BACKLOG | MOB-01.1; PILOT-01            | Catalogs, imports, email, audit, dashboard, evidence | Record A/B/C/D/E/F decision per family             |

### DS-02 safe CSS batches

| ID      | Task                                                | Phase | Priority | Status  | Dependencies                | Scope                                    | Verification/Evidence                              |
| ------- | --------------------------------------------------- | ----- | -------- | ------- | --------------------------- | ---------------------------------------- | -------------------------------------------------- |
| DS-02.1 | Consolidate token aliases                           | 6     | P1       | BACKLOG | DS-01; BASE-01; PILOT-01    | Legacy and semantic variables            | Computed-style parity and viewport evidence        |
| DS-02.2 | Consolidate auth styles                             | 6     | P1       | BACKLOG | AUTH-01; DS-02.1            | Login/recovery/reset/change              | Public four-viewport screenshots and accessibility |
| DS-02.3 | Consolidate table styles                            | 6     | P1       | BACKLOG | TABLE-01; PILOT-01; DS-02.1 | Table shell/header/cell/scroll rules     | Representative table families and edge geometry    |
| DS-02.4 | Consolidate form styles                             | 6     | P2       | BACKLOG | FORM-01; PILOT-01; DS-02.1  | Fields, sections, toolbars               | Four viewports and focus/error states              |
| DS-02.5 | Consolidate overlay styles                          | 6     | P1       | BACKLOG | A11Y-02; DS-02.1            | Dialogs, drawers, popovers               | Focus, viewport, stacking and pending evidence     |
| DS-02.6 | Consolidate Staff Shift local styles                | 6     | P2       | BACKLOG | MOB-01.6; DS-02.1           | Staff Shift page-local Tailwind variants | Preserve workflow and MedLabs identity             |
| DS-02.7 | Remove remaining verified-obsolete legacy selectors | 6     | P2       | BACKLOG | DS-02.1–DS-02.6             | Residual global CSS only                 | Per-selector evidence; no broad rewrite            |

## Reconciliation summary

```text
Audit IDs expected: 21
Tracker audit IDs mapped: 21
Unmapped audit IDs: none
New planning IDs: TRACK-01, BASE-01, DEC-01, PILOT-01, QA-01
```

## 2026-10-28 owner language correction

| ID       | Status | Scope and evidence                                                                                                                               | Remaining gate                                                                                                         |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| APP-I18N | VERIFY | Whole application VI/EN, Vietnamese default; cookie/SSR/provider, static UI labels/messages/ARIA; tests and language review in external07 report | Technical/rendered verification completed; owner visual review pending; pilot source publication explicitly authorized |

The parent plan and DES backlog remain partial/VERIFY as enumerated in the external07 status report. Do not mark inherited design items DONE because text translation exists.
