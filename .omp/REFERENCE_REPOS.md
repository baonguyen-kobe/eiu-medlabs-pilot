<!-- omp-managed-reference-repos:start -->

# Reference Repositories

## EIU Medlabs

- **Path:** `D:\orca\eiu-medlabs`
- **Role:** CANONICAL IMPLEMENTATION TARGET
- **Authority:** application architecture; Supabase architecture; authentication; personnel identity; authorization/RLS; database conventions; Next.js implementation; testing conventions; visual design; colors; typography; branding; and `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`.

When another reference conflicts with Medlabs architecture, security, or design, Medlabs wins unless the user explicitly decides otherwise.

## EIU Inventory Tracker

- **Path:** `D:\orca\eiu-inventory-tracker`
- **Role:** FEATURE / UX / GENERIC INVENTORY REFERENCE
- **Use for:** catalog, generic inventory item concepts, categories, suppliers, procurement, purchase orders, stock-movement ideas, requests, location-hierarchy concepts, dashboards/analytics, and Inventory UX.

Its runtime is currently demo/in-memory. Its `docs/migrations/*.sql` are proposed design material only. Do not treat its database, Auth, or RLS design as canonical.

## QLTBYT Nam Phong

- **Path:** `D:\orca\references\qltbyt-nam-phong`
- **Role:** MEDICAL EQUIPMENT DOMAIN / PRODUCT REFERENCE ONLY
- **Use for:** equipment asset identity; model, serial, and manufacturer; warranty; funding source; acquisition/in-service dates; depreciation; custodian/department; equipment status; QR workflows; usage history; maintenance; calibration; inspection; repair; external service providers; repair cost; transfer; loan; handover; return; disposal; lifecycle history; audit; and medical-equipment reporting.

Do not automatically adopt its features. Each feature requires product classification. Its architecture is not authoritative for Medlabs.

Never copy its NextAuth identity architecture, `nhan_vien` identity model, JWT tenant architecture, no-RLS strategy, RPC-only security model, role taxonomy, `don_vi` tenancy implementation, primary-key strategy, source naming, UI branding/design, or deployment assumptions. Learn domain behavior, not platform architecture.

## Source-of-Truth Hierarchy

When evaluating a future Inventory feature:

1. **Medlabs determines** architecture, security, identity, authorization, database-integration conventions, frontend framework, and design system.
2. **EIU Inventory contributes** generic Inventory feature and UX ideas.
3. **QLTBYT Nam Phong contributes** medical-equipment lifecycle and domain ideas.
4. A reference feature is never automatically adopted. Classify it as: `ADOPT V1`, `ADOPT LATER`, `ADAPT`, `MEDLABS ALREADY HAS EQUIVALENT`, `DO NOT ADOPT`, or `NEEDS PRODUCT DECISION`.
5. Never copy a reference schema mechanically. Translate a desired capability into a new Medlabs-compatible domain contract.

## Equipment Concept Warning

Do not assume these are the same entity:

- Inventory generic `Item`
- Skills `equipment_catalog`
- Basic Medical equipment catalog
- Basic Medical room inventory
- Nam Phong `thiet_bi`

They may overlap conceptually but currently have different operational semantics. Do not create a canonical Equipment entity until domain analysis proves that shared identity provides more benefit than coupling.

## Engineering Practices Worth Studying

QLTBYT Nam Phong may be used as a reference for database quality gates, migration verification, specification-first workflows, GIVEN/WHEN/THEN acceptance criteria, repair/maintenance domain invariants, and audit/history practices.

Do not copy its mandatory push workflow, AgentMemory configuration, context-mode configuration, repository-specific agent instructions, complete `AGENTS.md`/`CLAUDE.md`, or no-RLS assumptions. Any engineering-practice adoption requires explicit evaluation against current Medlabs tooling.
<!-- omp-managed-reference-repos:end -->
