# Documentation Authority and Precedence

This document defines the canonical documentation hierarchy, authority order, repository ownership, runtime contracts, and tool navigation policy for MedLabs Calendar (`eiu-medlabs`).

---

## 1. Authority Model

Documentation authority is resolved by the type of question being answered.
Do not use one flat precedence list for product intent, implementation state,
and production state.

### 1.1 Desired / normative behavior

Use this hierarchy when answering:

> What should MedLabs Calendar do?

1. **Explicit current user instruction**
   - A direct current instruction from the user takes precedence over earlier
     repository guidance unless it would violate an immutable safety,
     authorization, or data-integrity constraint that has not been explicitly
     changed.

2. **Approved current business, security, and product contracts**
   - Current authorization rules, role and capability contracts, domain
     boundaries, lifecycle rules, notification rules, data-integrity
     invariants, and other explicitly approved product decisions define the
     intended system behavior.

3. **Approved scoped OpenSpec contracts and durable recorded decisions**
   - Active, approved specifications refine the relevant business contract
     within their documented scope.
   - A historical or unapproved proposal cannot override an approved current
     contract.

4. **`docs/UI_DESIGN_SYSTEM_V2_MASTER.md` for visual behavior**
   - This file is the canonical visual/design-system authority only.
   - It does not redefine authorization, database, lifecycle, email, or other
     business behavior.

5. **Other current canonical documentation**
   - Includes current operational runbooks and repository guidance that does
     not conflict with a higher-authority contract.

Current implementation does not silently redefine desired behavior.
If source, schema, tests, or runtime disagree with an approved business or
security contract, treat the mismatch as implementation drift or a defect to
investigate.

### 1.2 Current implementation truth

Use these sources when answering:

> What does the current checked-out application actually do?

Inspect the effective implementation directly:

1. Current application source.
2. All relevant declarative schemas.
3. The effective forward migration chain.
4. Effective RLS policies, grants, triggers, RPCs, and functions.
5. Current automated tests.
6. Deterministic local reproduction or other verified runtime evidence.

Do not infer current implementation from an old review, handoff, initial
migration, isolated schema file, or dated report when the effective source can
be inspected.

Tests are evidence of intended/verified behavior, but a passing or stale test
does not override contradictory effective source or database behavior.
Investigate the mismatch.

### 1.3 Production truth

Use these sources when answering:

> What is actually live in production?

Production state must be verified independently from:

1. Exact deployed application SHA, including `/api/version` where available.
2. Actual remote Supabase migration history.
3. Current production database/configuration state relevant to the operation.
4. Current deployed integration configuration where applicable.

Repository documentation, commit dates, migration filenames, historical
deployment workflows, and old production ledgers do not by themselves prove
live production state.

### 1.4 Agent and documentation governance

`AGENTS.md` is the authoritative repository instruction file for agent
behavior, engineering workflow, code-navigation policy, verification
expectations, and repository safety rules.

`docs/DOCUMENTATION_AUTHORITY.md` defines how repository documents relate to
one another.

Supporting agent-specific entry points such as `CLAUDE.md` and `GEMINI.md`
must delegate to these authorities and must not introduce competing repository
policy.

### 1.5 Historical evidence

Dated audits, review reports, handoffs, checkpoints, worklogs, archived
findings, chat transcripts, GitHub issue/PR comments, and agent reports are
historical context and evidence. They do not automatically alter current
policy. When an approved decision changes repository policy or contracts, the
relevant canonical document must be updated rather than expecting future tasks
to reconstruct policy from past discussion. Minor incidental statements do not
require manufactured documents.

GitHub is a durable versioning, issue-tracking, review, and delivery log; it is
not an interactive transport channel required for OMP to inspect or mutate the
local working tree.

Historical evidence may explain why a decision was made, but it cannot override:

- explicit current user instruction (which retains highest priority under 1.1),
- an approved current business/security contract,
- effective current implementation,
- current UI authority,
- current modernization state,
- or independently verified production state.

---

## 2. Repository and Branch Ownership

- **Canonical MedLabs Repository:** `baonguyen-kobe/eiu-medlabs`
- **Canonical Delivery Remote:** `origin`
- **Active Integration Branch:** `ui-modernization`
- **Release / Production Delivery Branch:** `main`
- **Frozen Historical Modernization Source:**
  `baonguyen1301/eiu-medlabs@e42b2ed6cbd89bb080a2c74d62f659560207b792`
  - Retained as historical modernization source and Git history reference.
  - It is no longer the active MedLabs feature-delivery target.
  - No new MedLabs feature delivery should be performed there after promotion.

`ui-modernization` in `baonguyen-kobe/eiu-medlabs` is the canonical integration
branch after promotion.

`main` remains the canonical release/deployment branch.

Promotion into `ui-modernization` does not authorize merging to `main`,
database mutation, production migration, or production deployment.

---

## 3. Runtime Roles and Capability Contracts

The current assignable application roles are:

- `admin`
- `staff`
- `teaching_assistant`
- `lecturer`
- `viewer`

The PostgreSQL enum `public.app_role` still retains the deprecated value
`importer` so the historical migration chain can be replayed safely.

`importer` is compatibility-only:

- it is not a current primary assignable application role;
- new application writes and authorization must not rely on it as a primary
  role;
- historical migrations or legacy data may still contain the enum value and
  must not be rewritten merely to remove it.

### Schedule Import Capability

Schedule import is controlled by:

`profiles.can_import_schedules`

combined with a supported current role and the required room-type scope.

The import capability is not a standalone primary role.

When documentation, tests, or implementation use legacy `Importer`
terminology, verify whether that usage is historical compatibility or an
actual defect before changing data or migration history.
---

## 4. Codebase Navigation Policy

Use the smallest sufficient navigation method for the task:

1. **Direct inspection and search (`read`, `grep`, `glob`):**
   - Default for localized, surgical edits, single-component changes, and straightforward investigations.
2. **GitNexus (`gitnexus-code-intelligence` MCP / CLI):**
   - Use when repository-level architecture, multi-file dependency tracing, caller graphs, shared consumers, or blast radius analysis is useful.
   - Do not require GitNexus for localized edits.
3. **Graphify:**
   - Optional when `graphify-out/graph.json` exists and is current.
   - Never mandatory before codebase exploration or localized edits.
4. **Version-matched Next.js guidance (`NEXTJS_AGENTS.md`):**
   - Read `NEXTJS_AGENTS.md` before changing Next.js behavior to reference documentation bundled with the installed framework version.

---

## 5. UI Authority and Supplemental References

- **Canonical Visual Authority:** `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`
  - Defines the authoritative EIU MedLabs design system: Be Vietnam Pro typography, EIU blue/gold/cream color tokens, surface elevations, card geometry, and component variants.
- **Continuity and State Authority:** `docs/ui-modernization/` (`DECISIONS.md`, `CURRENT.md`, `TRACKER.md`)
  - Governs active modernization tasks, verified mobile strategies (Strategies A–F), and batch history.
- **Supplemental Legacy Layout Reference:** `docs/UI_LAYOUT_SPEC.md`
  - Supplemental reference for calendar grid details and historical layout context. Cannot override the UI Master or modernization decisions.
- **Supplemental Review Checklist:** `docs/UI_REVIEW_GUIDE.md`
  - Supplemental checklist for manual visual reviews. Cannot override current source, server RLS, or UI Master rules.

---

## 6. Historical Documents and Archive Policy

- Historical audit files and review notes document past findings and must not be treated as active task lists or authoritative design rules.
- Durable rules must be migrated to `UI_DESIGN_SYSTEM_V2_MASTER.md`, `DOCUMENTATION_AUTHORITY.md`, or `AGENTS.md`.
- Bulk cleanup, archiving, or deletion of historical artifacts is performed in dedicated docs-only maintenance tasks, never mixed into visual feature delivery.

---

## 7. Production Verification Disclaimer

- Documentation alone **never** constitutes proof of live production state.
- Production status requires explicit release SHA verification, live application inspection, verified remote migration history, and current operational configuration.
