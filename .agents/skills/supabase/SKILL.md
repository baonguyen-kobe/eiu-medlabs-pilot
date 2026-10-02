---
name: supabase
description: "Use when doing ANY task involving Supabase. Triggers: Supabase products (Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues); client libraries and SSR integrations (supabase-js, @supabase/ssr) in Next.js, React, SvelteKit, Astro, Remix; auth issues (login, logout, sessions, JWT, cookies, getSession, getUser, getClaims, RLS); Supabase CLI or MCP server; schema changes, migrations, declarative schemas, security audits, Postgres extensions (pg_graphql, pg_cron, pg_vector); debugging and troubleshooting errors or unexpected behavior on Supabase projects (HTTP errors, Postgres errors, RLS surprises, permission denied, schema cache issues, timeouts, Edge Function crashes, Realtime drops, Storage failures) and reading or querying logs (Logs Explorer, ClickHouse)."
metadata:
  author: supabase
  version: "0.1.2"
---

# Supabase

## MedLabs repository-first override

These MedLabs rules override any generic workflow later in this upstream skill
when the two conflict.

- Supabase MCP is an optional external integration. Do not create, modify, or
  activate `.mcp.json` or any other MCP configuration during ordinary MedLabs
  implementation unless the current user/Reviewer explicitly authorizes an MCP
  setup task.
- Repository schema, forward migrations, RLS/RPC/function definitions, and
  their tests are the normal database write authority.
- Do not use MCP `execute_sql`, MCP `apply_migration`, `supabase db query`, or
  another direct remote-database write as an iterative scratchpad for MedLabs
  schema, RLS, RPC, function, grant, or trigger changes.
- For an approved database change, inspect the current declarative schema and
  effective forward migration chain, modify the approved repository source,
  add or update the required regression evidence, and use the repository/CI
  validation path.
- Production database mutation always requires separate explicit authorization
  under `docs/RELEASE.md`.
- If MCP is unavailable, use current official Supabase documentation through
  another approved documentation path. Missing MCP is not a blocker for normal
  MedLabs source work.

## Core Principles

**1. Consult official docs when task depends on platform/API/version behavior.**
Do not rely on outdated memory or training data for Supabase platform features. Consult official Supabase documentation when the task depends on platform, library, or API behavior.

Inspect `https://supabase.com/changelog.md` only during version upgrades, breaking changes, or when version uncertainty arises; do not perform blanket changelog scans for docs-only edits or verified local logic.
**2. Verify through the MedLabs verification gate.**
After implementing a MedLabs change, use `medlabs-verification-gate` to select
the smallest sufficient evidence for the actual blast radius.

Do not require a database query merely because the task involves Supabase.

Run a database query only when it is materially required by the approved
verification scope and the current task provides an authorized safe database
access path.

An unavailable MCP or remote database does not make an otherwise verifiable
repository change incomplete.

**3. Recover from errors, don't loop.**
If an approach fails after 2-3 attempts, stop and reconsider. Try a different method, check documentation, inspect the error more carefully, and review relevant logs when available. Supabase issues are not always solved by retrying the same command, and the answer is not always in the logs, but logs are often worth checking before proceeding.

**4. Exposing tables to the Data API:** Depending on the user's [Data API settings](https://supabase.com/dashboard/project/<ref>/integrations/data_api/settings), newly created tables may not be automatically exposed via the Data (REST) API. If this is the case, `anon` and `authenticated` roles will need to be explicitly granted access.

> Note that this is separate from RLS, which controls which _rows_ are visible once a table is accessible, not whether the table is accessible at all.

When a user reports a SQL-created table is unexpectedly inaccessible, check their Data API settings and whether the roles have been granted access via explicit `GRANT` SQL. When granting public (`anon`/`authenticated`) access, always enable RLS too. See [Exposing a Table to the Data API](https://supabase.com/docs/guides/api/securing-your-api.md) for the full setup workflow.

**5. RLS in exposed schemas.**
Enable RLS on every table in any exposed schema, which includes `public` by default. This is critical in Supabase because tables in exposed schemas can be reachable through the Data API when the `anon`/`authenticated` roles have access (see [Exposing a Table to the Data API](https://supabase.com/docs/guides/api/securing-your-api.md)). For private schemas, prefer RLS as defense in depth. After enabling RLS, create policies that match the actual access model rather than defaulting every table to the same `auth.uid()` pattern.

**6. Security checklist.**
When working on any Supabase task that touches auth, RLS, views, storage, or user data, run through this checklist. These are Supabase-specific security traps that silently create vulnerabilities:

- **Auth and session security**
  - **Never use `user_metadata` claims in JWT-based authorization decisions.** In Supabase, `raw_user_meta_data` is user-editable and can appear in `auth.jwt()`, so it is unsafe for RLS policies or any other authorization logic. Store authorization data in `raw_app_meta_data` / `app_metadata` instead.
  - **Deleting a user does not invalidate existing access tokens.** Sign out or revoke sessions first, keep JWT expiry short for sensitive apps, and for strict guarantees validate `session_id` against `auth.sessions` on sensitive operations.
  - **If you use `app_metadata` or `auth.jwt()` for authorization, remember JWT claims are not always fresh until the user's token is refreshed.**

- **API key and client exposure**
  - **Never expose the `service_role` or secret key in public clients.** Prefer publishable keys for frontend code. Legacy `anon` keys are only for compatibility. In Next.js, any `NEXT_PUBLIC_` env var is sent to the browser.

- **RLS, views, and privileged database code**
  - **Views bypass RLS by default.** In Postgres 15 and above, use `CREATE VIEW ... WITH (security_invoker = true)`. In older versions of Postgres, protect your views by revoking access from the `anon` and `authenticated` roles, or by putting them in an unexposed schema.
  - **UPDATE requires a SELECT policy.** In Postgres RLS, an UPDATE needs to first SELECT the row. Without a SELECT policy, updates silently return 0 rows — no error, just no change.
  - **`auth.role()` is deprecated — use the `TO` clause instead.** Supabase has deprecated `auth.role()` in favour of specifying the target role directly on the policy with `TO authenticated` or `TO anon`. Beyond deprecation, `auth.role() = 'authenticated'` breaks silently when anonymous sign-ins are enabled, because anonymous users carry the `authenticated` Postgres role and pass the check regardless of whether the user is genuinely signed in.
    ```sql
    -- Deprecated (do not use)
    create policy "example" on table_name for select
    using ( auth.role() = 'authenticated' );
    ```
  - **`TO authenticated` alone is authentication without authorization (BOLA / IDOR).** Using `TO authenticated` only checks the role — it does not restrict which rows a user can access. The correct pattern combines `TO authenticated` with an ownership predicate in `USING`:
    ```sql
    create policy "example" on table_name for select
    to authenticated
    using ( (select auth.uid()) = user_id );
    ```
  - **UPDATE policies require both `USING` and `WITH CHECK`.** Without `WITH CHECK`, a user can reassign a row's `user_id` to another user:
    ```sql
    create policy "example" on table_name for update
    to authenticated
    using ( (select auth.uid()) = user_id )
    with check ( (select auth.uid()) = user_id );
    ```
  - **`SECURITY DEFINER` functions bypass RLS.** A `SECURITY DEFINER` function runs with its creator's privileges — typically a role with `bypassrls` (e.g., `postgres`). Never add `SECURITY DEFINER` to resolve a permission error; it silently removes access control without fixing the underlying cause. Prefer `SECURITY INVOKER`.
  - **`SECURITY DEFINER` functions in `public` are callable by all roles.** Postgres grants `EXECUTE` to `PUBLIC` by default for every new function, so any `SECURITY DEFINER` function in `public` is a public API endpoint callable by `anon` and `authenticated` (which inherit from `PUBLIC`) without any additional grant. When `SECURITY DEFINER` is genuinely needed (e.g., bypassing RLS on an internal lookup table), keep the function in a non-exposed schema, always include an `auth.uid()` check in the function body, and run `supabase db advisors` after making changes.

- **Storage access control**
  - **Storage upsert requires INSERT + SELECT + UPDATE.** Granting only INSERT allows new uploads but file replacement (upsert) silently fails. You need all three.

- **Dependency and supply-chain security**
  - **Always pin package versions and commit lockfiles** when installing Supabase packages (`supabase-js`, `@supabase/ssr`, `supabase-py`, etc.). See the [npm security guide](https://supabase.com/docs/guides/security/npm-security.md) for the full checklist.

For any security concern not covered above, fetch the Supabase product security index: `https://supabase.com/docs/guides/security/product-security.md`

## Supabase CLI

Discover commands via `--help` before using unverified commands or flags, or when CLI version changes. Within the same task on the same known CLI version, reuse previously discovered flags rather than repeating identical `--help` lookups mechanically.

```bash
supabase --help                    # All top-level commands
supabase <group> --help            # Subcommands (e.g., supabase db --help)
supabase <group> <command> --help  # Flags for a specific command
```

**Supabase CLI Known gotchas:**

- `supabase db query` requires **CLI v2.79.0+**. In MedLabs, do not substitute MCP `execute_sql` or `psql` for repository-controlled database writes. For an explicitly required read-only diagnostic query, use only an access path that is already available and authorized by the current task.
- `supabase db advisors` requires **CLI v2.81.3+** → fallback to MCP `get_advisors` only if MCP is actually available and the task permits it.
- In imperative migration projects, create new hand-authored migration files with `supabase migration new <name>` first. Never invent a migration filename or rely on memory for the expected format. Declarative schema projects generate migrations from `supabase/schemas/`; see "Making and Committing Schema Changes" below.

**Version check and upgrade:** Run `supabase --version` to check. For CLI changelogs and version-specific features, consult the [CLI documentation](https://supabase.com/docs/reference/cli/introduction) or [GitHub releases](https://github.com/supabase/cli/releases).

## Supabase MCP Server

Supabase MCP is optional for MedLabs and is not part of ordinary source-work
prerequisites.

Do not automatically create or modify `.mcp.json`, `.omp/mcp.json`, global OMP
MCP configuration, OAuth configuration, project linkage, or credentials.

If the current task is explicitly an MCP setup or MCP diagnostic task, consult
the current official Supabase MCP documentation and follow the separately
approved MedLabs MCP contract.

For ordinary implementation, continue without MCP when it is unavailable.

## Supabase Documentation

When a task depends on Supabase platform/API behavior, find the relevant documentation:

1. **MCP `search_docs` tool** — use only when already mounted and available in the active runtime.
2. **Fetch official Supabase docs pages as markdown** — append `.md` to the URL path (e.g. `https://supabase.com/docs/...md`).
3. **Web search** for Supabase-specific topics when the exact official URL path is unknown.

Missing MCP must not block documentation lookup. Do not scan documentation for routine repository source edits whose behavior is already verified.

## Making and Committing Schema Changes

MedLabs uses repository-controlled database change artifacts.

The current repository declares declarative schema paths under
`supabase/schemas/`.

For any approved schema, RLS, grant, RPC/function, trigger, or related database
change:

1. inspect the relevant current declarative schema;
2. inspect the effective forward migration chain;
3. inspect the relevant RLS/grants/functions/tests;
4. apply the exact approved change to repository-controlled schema/migration
   artifacts;
5. add or update the required regression tests;
6. use the repository's applicable CI/database validation path.

Do not use a remote Supabase database as an iterative scratchpad.

Do not use MCP `execute_sql`, MCP `apply_migration`, `supabase db query`, or an
equivalent direct remote write merely to experiment before creating the
repository change.

Do not invent a new migration workflow when the current Reviewer/task contract
or repository pattern already specifies one.

Production database mutation is a separate release operation and requires
explicit current authorization under `docs/RELEASE.md`.

## Debugging

If the current user or independent Reviewer has already supplied a verified
root cause and settled exact implementation contract, follow
`medlabs-implement-contract`; do not restart diagnosis merely because the issue
involves Supabase.

When root cause is genuinely unknown and the issue involves Supabase REST,
Postgres/PostgREST, Auth, Realtime, Edge Functions, Storage, RLS, permissions,
timeouts, or related platform behavior, consult the current official Supabase
Monitoring and Debugging documentation before proposing a diagnosis that
depends on platform behavior.

Use current documentation rather than remembered Supabase behavior.

Do not access production data or logs unless the current task explicitly
authorizes that diagnostic access.

## Reference Guides

- **Skill Feedback** → [references/skill-feedback.md](references/skill-feedback.md)
  **MUST read when** the user reports that this skill gave incorrect guidance or is missing information.
