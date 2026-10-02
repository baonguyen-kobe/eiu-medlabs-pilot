# Workflow audit findings

## Technical correction — stale completion regression expectation

**Severity:** P1  
**Workflow:** Equipment request lifecycle  
**Classification:** TECHNICAL

**Problem:** the end-to-end test reset a completed request to `new`, then expected an operator to select `completed` directly.

**Root cause:** this disagreed with both current product layers:

- `manager_confirm_equipment_status` rejects direct completion; completion is produced only by both return confirmations.
- `components/equipment-request-list.tsx` disables the `Hoàn Thành` action unless the request is already completed.

**Impact:** the regression test encoded an impossible transition and would either fail or obscure the two-party return invariant.

**Correction:** `tests/e2e/native-registration.spec.ts` now asserts that `Hoàn Thành` is disabled after the privileged rollback to `new`.

**Verification:** Playwright discovered all six tests in `native-registration.spec.ts`; lint and typecheck pass. Full browser execution requires the unavailable local Supabase Docker engine.

## Technical correction — generated Liam site excluded from application lint

**Severity:** P2  
**Workflow:** Verification tooling  
**Classification:** TECHNICAL

**Problem:** the project lint command analyzed Liam's generated/minified static-site bundle and failed with React-hook lint errors from third-party output.

**Root cause:** `eslint.config.mjs` did not ignore `docs/erd/liam/site/**`, even though the directory is generated documentation, not application source.

**Correction:** added `docs/erd/liam/site/**` to the existing global generated-output ignores.

**Why technically safe:** this scope excludes only Liam-generated static assets; first-party application source remains linted.

**Verification:** `npm run lint && npm run typecheck` passes after this exclusion.

## Business decision required — cancellation after operational handover

**Severity:** P1  
**Workflow:** Equipment request lifecycle  
**Classification:** BUSINESS

`soft_cancel_equipment_request` allows an authorized registrant/creator/manager to cancel any non-cancelled request; no status guard excludes `handed_over`, `returned`, or `completed`. The UI exposes cancellation for every non-cancelled request. Repository evidence does not state whether post-handover cancellation is a correction, a return conversion, or prohibited.

No behavior was changed because the correct restriction is policy-dependent.

## Technical risk — personnel service-role assertion

**Severity:** P2  
**Workflow:** Personnel password operation  
**Classification:** TECHNICAL RISK

`private.assert_personnel_password_operation_service` uses `auth.role()` inside a privileged password-operation flow. It remains protected and current repository behavior was not changed. Validate this primitive against the deployed Supabase runtime and current RLS guidance before any migration because this cross-system recovery path depends on it.

## Integration-risk boundaries

- Email/outbox delivery has durable enqueue and protected recovery endpoints, but no live provider result was available.
- GitNexus execution-flow query returned no matches because its FTS index is degraded. No graph reindex was run because the requested audit is on-demand and should not add an automatic scan.
- The local Supabase Docker Linux engine is unavailable; live RLS/RPC tests cannot be run in this session.
