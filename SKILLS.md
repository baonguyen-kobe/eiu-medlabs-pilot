# MedLabs Orca/OMP Profile v4

`SKILLS.md` is the curated skill manifest and routing guide for MedLabs
Calendar.

It defines which skills should be used and when.

It is not a product-policy authority.

Product, security, implementation, UI, verification, and production truth are
resolved through `AGENTS.md`, `docs/DOCUMENTATION_AUTHORITY.md`, current source,
and `docs/RELEASE.md`.

## Core routing

| Situation                                                                                           | Skill                                                                                    |
| :-------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| Verified root cause or settled exact implementation contract supplied                               | `medlabs-implement-contract`                                                             |
| Root cause is genuinely unknown                                                                     | `systematic-debugging`                                                                   |
| Supabase Auth/client/platform behavior                                                              | `supabase`                                                                               |
| SQL/PostgreSQL performance, indexes, locks, schema structure or migration design                    | `supabase-postgres-best-practices`                                                       |
| RLS, grants, authorization or privileged Supabase database behavior                                 | `supabase` first; `supabase-postgres-best-practices` only as secondary advisory guidance |
| React/Next.js implementation or performance                                                         | `vercel-react-best-practices`                                                            |
| Reusable component API or composition architecture                                                  | `vercel-composition-patterns`                                                            |
| Explicit generic UI/UX review                                                                       | `web-design-guidelines`                                                                  |
| Keyboard, focus, semantic HTML, ARIA, screen-reader or WCAG behavior                                | `accessibility`                                                                          |
| Test-first work where TDD materially improves a high-risk behavioral contract                       | `tdd`                                                                                    |
| Explicit check for unnecessary abstractions or over-engineering                                     | `ponytail-review`                                                                        |
| Vercel Preview explicitly authorized                                                                | `medlabs-vercel-preview`                                                                 |
| Release/production work explicitly authorized                                                       | `medlabs-release-preflight`                                                              |
| Completion and verification reporting                                                               | `medlabs-verification-gate`                                                              |
| Unfamiliar architecture, cross-file impact analysis, blast-radius exploration (optional supplement) | `gitnexus-code-intelligence`                                                             |
| Explore candidate feature scope or design options (optional supplement)                             | `openspec-explore`                                                                       |
| Propose cross-cutting, schema, breaking, or durable changes (optional supplement)                   | `openspec-propose`                                                                       |
| Implement approved OpenSpec tasks against effective source (optional supplement)                    | `openspec-apply-change`                                                                  |
| Archive verified OpenSpec change with evidence and limitations (optional supplement)                | `openspec-archive-change`                                                                |
| Synchronize specifications across changes (optional supplement)                                     | `openspec-sync-specs`                                                                    |
| Update or refine an in-flight OpenSpec proposal (optional supplement)                               | `openspec-update-change`                                                                 |

## Authority boundaries

Skills guide implementation method. They do not redefine MedLabs behavior.

For desired behavior, implementation truth, and production truth, follow
`docs/DOCUMENTATION_AUTHORITY.md`.

For Next.js framework behavior, use `NEXTJS_AGENTS.md` and the documentation
bundled with the installed Next.js version before generic external guidance.

For Supabase, approved MedLabs business/security contracts and actual effective
schema/migrations/RLS/RPC behavior outrank generic skill recommendations.

Repository schema and migration files remain the database change authority.

Supabase skills must not automatically configure MCP or use a remote database
as an iterative write scratchpad. Production database mutation requires a
separately authorized release operation.

For visual behavior, `docs/UI_DESIGN_SYSTEM_V2_MASTER.md` is the canonical UI
authority after business/security requirements.

For release and production, `docs/RELEASE.md` is authoritative.

## Profile inventory

### CORE

_Note: A `CORE` designation does not mean loading all core skills at session start. Load skills on demand per task, not merely because the repository uses that technology. Reuse already-read skill content within the same task when files have not changed._

#### karpathy-coding-heuristics

- Source type: CUSTOM
- Path: `.agents/skills/karpathy-coding-heuristics`
- Purpose: simple, surgical, evidence-driven implementation.
- Do not use it to override a settled product contract.

#### medlabs-implement-contract

- Source type: CUSTOM
- Path: `.agents/skills/medlabs-implement-contract`
- Purpose: execute a verified implementation contract without reopening design. Does not require an external Reviewer role; applies whenever an exact fix contract has been verified, while the executor verifies the source anchor.

#### medlabs-verification-gate

- Source type: CUSTOM
- Path: `.agents/skills/medlabs-verification-gate`
- Purpose: change-aware MedLabs completion evidence.

### TASK_TRIGGERED

#### systematic-debugging

- Source type: ADAPTED_FROM_UPSTREAM
- Upstream: `obra/superpowers`
- SHA: `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- Upstream path: `skills/systematic-debugging`
- Local path: `.agents/skills/systematic-debugging`
- Use only when root cause is not already independently verified.
- Adaptations: settled-contract routing; MedLabs TDD routing; MedLabs verification gate.

#### supabase

- Source type: ADAPTED_FROM_UPSTREAM
- Upstream: `supabase/agent-skills`
- SHA: `8331f910845103c08d51f6ca1d86ebb7d1f745e3`
- Upstream path: `skills/supabase`
- Local path: `.agents/skills/supabase`
- Adaptations: MedLabs repository-first database writes; consult official Supabase documentation when the task depends on platform/API/version behavior; inspect changelog only for upgrades, breaking changes, or version uncertainty (no blanket scans for docs-only edits or verified logic); consult CLI help before unverified commands or flags and reuse same-version help within the task; `get_advisors` fallback only if MCP is actually available and permitted; MCP is optional and never auto-configured; no remote database scratchpad workflow; verification delegates to `medlabs-verification-gate`; independently verified root causes route to `medlabs-implement-contract`.

#### supabase-postgres-best-practices

- Source type: ADAPTED_FROM_UPSTREAM
- Upstream: `supabase/agent-skills`
- SHA: `8331f910845103c08d51f6ca1d86ebb7d1f745e3`
- Upstream path: `skills/supabase-postgres-best-practices`
- Local path: `.agents/skills/supabase-postgres-best-practices`
- Adaptations: Supabase security guidance takes precedence for RLS/grants; UPDATE/FOR ALL policies require appropriate `USING` and `WITH CHECK`; generic privilege examples are advisory only.
- Advisory only; actual MedLabs contracts/schema/runtime outrank examples.

#### vercel-react-best-practices

- Source type: UPSTREAM_PINNED
- Upstream: `vercel-labs/agent-skills`
- SHA: `063bee94c3f4df8453406c830b0a7df0f2860278`
- Upstream path: `skills/react-best-practices`
- Local path: `.agents/skills/vercel-react-best-practices`

#### vercel-composition-patterns

- Source type: UPSTREAM_PINNED
- Upstream: `vercel-labs/agent-skills`
- SHA: `063bee94c3f4df8453406c830b0a7df0f2860278`
- Upstream path: `skills/composition-patterns`
- Local path: `.agents/skills/vercel-composition-patterns`

#### web-design-guidelines

- Source type: UPSTREAM_PINNED
- Upstream: `vercel-labs/agent-skills`
- SHA: `063bee94c3f4df8453406c830b0a7df0f2860278`
- Upstream path: `skills/web-design-guidelines`
- Local path: `.agents/skills/web-design-guidelines`
- Review guidance only; it does not replace the MedLabs UI Master.

#### accessibility

- Source type: UPSTREAM_PINNED
- Upstream: `affaan-m/ECC`
- SHA: `22e8cf01d0b54719b3a49002fab2ccbda4ff5b9e`
- Upstream path: `skills/accessibility`
- Local path: `.agents/skills/accessibility`

#### tdd

- Source type: ADAPTED_FROM_UPSTREAM
- Upstream: `mattpocock/skills`
- SHA: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- Upstream path: `skills/engineering/tdd`
- Local path: `.agents/skills/tdd`
- Use on demand for high-risk behavioral seams, not ceremonially for every change.
- Adaptations: Reviewer-provided seams count as approved; no dependency on `codebase-design`; no dependency on `code-review`.

#### ponytail-review

- Source type: UPSTREAM_PINNED
- Upstream: `DietrichGebert/ponytail`
- SHA: `2ed6c52c9d7e5e56942508591085fd45dea277d3`
- Upstream path: `skills/ponytail-review`
- Local path: `.agents/skills/ponytail-review`
- One-shot over-engineering review only. Persistent Ponytail modes are not part of MedLabs.

### PREVIEW_ONLY

#### medlabs-vercel-preview

- Source type: CUSTOM
- Path: `.agents/skills/medlabs-vercel-preview`
- Never authorizes production.

### RELEASE_ONLY

#### medlabs-release-preflight

- Source type: CUSTOM
- Path: `.agents/skills/medlabs-release-preflight`
- Always delegates production policy to `docs/RELEASE.md`.

### WORKSPACE_SUPPLEMENT (ON DEMAND)

#### gitnexus-code-intelligence

- Source type: WORKSPACE_SUPPLEMENT
- Path: `.omp/skills/gitnexus-code-intelligence`
- Purpose: structural code intelligence, blast-radius analysis, dependency flow tracing.
- Advisory and navigation support only; code graphs do not prove runtime correctness. Follow the graph navigation routing rules below.

#### openspec-explore, openspec-propose, openspec-apply-change, openspec-archive-change, openspec-sync-specs, openspec-update-change

- Source type: WORKSPACE_SUPPLEMENT
- Path: `.omp/skills/openspec-*`
- Purpose: structured spec-driven change workflow for cross-cutting, schema, breaking, or durable changes.
- Complements `/opsx-*` command entrypoints. Do not load OpenSpec for minor typo fixes or localized UI adjustments.

## Documentation/tool routing

Next.js:

`NEXTJS_AGENTS.md` → installed-version Next.js docs. Consult topic-specific docs only when modifying Next.js framework behavior; do not scan all framework pages for unrelated tasks.

Supabase:

MedLabs contract/current implementation → curated Supabase skills → official Supabase documentation/tools when needed.

Other third-party libraries:

Use current authoritative documentation when necessary. Context7 may be added later as an optional documentation MCP; it is not required for daily MedLabs work.

### Graph navigation routing

1. **Local known-file edit:** Use direct source inspection and LSP; do not call code graphs merely to satisfy a checklist.
2. **Broad diff/review:** If Code Review Graph (CRG) is separately configured, mounted, and indexed, use `detect_changes_tool` for risk triage and `get_review_context_tool` only when context is needed; pass explicit `repo_root` and actual delivery base, not defaulting to `HEAD~1` for an entire PR. Use minimal/no-source response first and check for truncation/partial/stale flags.
3. **GitNexus fallback:** If CRG is unavailable, use GitNexus `detect_changes` for broad diff triage; do not block tasks to install CRG. Do not mechanically invoke multiple broad tools on the same diff.
4. **Highest-risk symbols:** GitNexus `context` to disambiguate, `impact` with correct direction/depth, `trace` only for specific call-path questions. Exact symbol identity does not prove graph completeness; verify consequential caller/type references via source/LSP and targeted checks.
5. **Graphify:** Optional historical tooling only: use only when an existing graph provides information unavailable from the above; do not rebuild all three graphs per task. If a graph is missing, stale, or partial, do not interpret "no results" as "no impact"; fall back to direct source and LSP.
6. **Tool boundary:** Do not install CRG, auto-hooks, GitHub Actions, or modify MCP configs as part of normal tasks. If a user wishes to set up CRG, that requires a dedicated setup scope with exact tool schemas and measured baselines.

### MCP integration policy

Skills are distinct from MCP tools. The active runtime/tool inventory determines availability. Do not install additional MCPs (Vercel, Supabase, Context7) or modify credentials for OMP. Use existing source, local CLI, and browser tools within scope. When GitNexus MCP indexes multiple repositories, always pass explicit `repo: "eiu-medlabs"` (or exact workspace path). Do not assume CWD auto-routing.

## Verification

Use `medlabs-verification-gate`.

Valid labels are exactly:

- `RUN AND PASS` — executed against the current relevant change;
- `RUN AND FAIL` — executed and failed; blocks task completion;
- `REUSED PRIOR PASS — UNCHANGED IMPACT` — not rerun because prior evidence remains applicable and impact unchanged;
- `NOT RUN — NOT REQUIRED FOR CURRENT IMPACT` — outside the verified blast radius;
- `NOT RUN — BLOCKED` — check could not start due to missing environment/fixture; blocks task completion.

Never call an unexecuted check PASS. Required checks that fail or are blocked prevent claiming task completion; they must not be converted into not-required.
