---
name: medlabs-release-preflight
description: Release-only MedLabs preflight and production-verification procedure. Always delegates policy to docs/RELEASE.md and cannot deploy or mutate production without explicit current authorization.
---

# MedLabs Release Preflight

## Authority

Read `docs/RELEASE.md` first.

`docs/RELEASE.md` is authoritative.

This skill is procedural only and must not copy, redefine, weaken, or supersede
that policy.

## Preflight (Read-Only)

Before any release action, establish the baseline state:

1. **Exact release SHA:** identify the exact reviewed commit SHA targeted for release.
2. **CI evidence:** verify applicable CI check passes for that SHA.
3. **Branch state:** verify working tree is on `main`, `HEAD == origin/main`, and checkout is completely clean.
4. **Scope determination:** determine whether this release involves application deployment, database migration, or both.
5. **Database pending set (only when DB release is involved):** query actual remote Supabase migration history and determine the exact dry-run pending set. Do not query or prepare DB migrations for application-only releases.

## Authorization gates

- A merge to `main` does NOT authorize production deployment.
- Production application deployment requires explicit current authorization.
- Production database mutation requires separate explicit current authorization.
- If a database migration delta exists without database authorization, STOP and report the exact blocker. Never mutate production databases without separate authorization.

## Authorized production execution

1. **Application deployment:** When production application deployment is explicitly authorized, use the repository-controlled script `scripts/deploy-production.ps1`. Do not substitute generic Vercel deployment commands or skills.
2. **Missing prerequisites:** If required access, tools, credentials, or authorizations are missing, report the exact blocker immediately; do not fall back to generic production deployment.
3. **Operational handling:** Follow `docs/RELEASE.md` for specific edge cases:
   - *Actual pending migration set* → see `docs/RELEASE.md`
   - *Partial migration handling* → see `docs/RELEASE.md`
   - *Pre-launch test data fast path* → see `docs/RELEASE.md`
   - *Deployment hang recovery* → see `docs/RELEASE.md`
   - *Interactive production credentials* → see `docs/RELEASE.md`

## Live verification

After an authorized deployment, verify production using live evidence:

1. Verify the exact deployed application SHA via `/api/version` at the public production alias (`https://medlabs-calendar.vercel.app/api/version`).
2. Run the required production smoke verification.
3. Repository history, commit dates, or local builds alone do not prove production state.
