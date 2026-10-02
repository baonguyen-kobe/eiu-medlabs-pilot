<!-- omp-managed-skill-stack:start -->

# MedLabs Calendar — OMP Workspace Adapter

This workspace delegates directly to canonical MedLabs authorities:

- **Engineering & Workflow Authority:** `AGENTS.md` (repository root)
- **Documentation Hierarchy & Precedence:** `docs/DOCUMENTATION_AUTHORITY.md`
- **Skill Routing & Curated Manifest:** `SKILLS.md` (repository root)
- **Runtime Stack & Quality Scripts:** `package.json`
- **Visual & Design Authority:** `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`

Local curated skills under `.agents/skills` defined in `SKILLS.md` supersede any generic or older skill names in global agent configurations (e.g. `medlabs-verification-gate` governs completion, `vercel-composition-patterns` replaces generic patterns, and curated `.agents/skills/supabase` governs Supabase access). Do not activate skills by default; select the minimal sufficient skill set matching the active task.
<!-- omp-managed-skill-stack:end -->

<!-- omp-managed-reference-policy:start -->

Reference repositories are documented in `.omp/REFERENCE_REPOS.md`.

For cross-repository Inventory design:

- Medlabs = implementation/security/design authority
- eiu-inventory-tracker = generic Inventory feature reference
- qltbyt-nam-phong = medical equipment lifecycle reference

Reference repositories must not override Medlabs architecture.
Use the smallest relevant evidence set.
<!-- omp-managed-reference-policy:end -->

<!-- omp-managed-inventory-continuity:start -->

Inventory / Equipment architecture authority lives in `D:\orca\medlabs-OPs`.

Before Inventory planning or implementation, read:

- `D:\orca\medlabs-OPs\CURRENT_STATE.md`
- `D:\orca\medlabs-OPs\NEXT_ACTION.md`
- `D:\orca\medlabs-OPs\SESSION_HANDOFF.md`
- the relevant control-plane Page Spec, D2 diagram, and requirement.

Hard rule: do not implement an Inventory page or feature unless its design status in `medlabs-OPs` is **APPROVED**. Do not copy all `medlabs-OPs` content into this application repository.
<!-- omp-managed-inventory-continuity:end -->
