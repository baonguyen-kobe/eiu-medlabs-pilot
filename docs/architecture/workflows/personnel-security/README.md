# Personnel, RBAC, and password-operation workflow

**Risk:** CRITICAL  
**Evidence:** IMPLEMENTED unless marked otherwise.

## Purpose and entry points

Administrators manage personnel profile data, roles, workspace scopes, import permissions, and password recovery/change operations. The design keeps external Supabase Auth updates separate from durable application-side authority records.

Primary code: `app/admin/actions.ts`, `app/login/actions.ts`, `lib/workspace-access.ts`, `lib/personnel-reconciliation.ts`.  
Database authority: `supabase/schemas/01_app.sql`, `06_sixth_followup_personnel_and_basic_medical.sql`, `17_personnel_password_and_catalog_batches.sql`, and `20_operations_integrity_master_batch.sql`.

## Main flows

### Authentication and workspace routing

1. User signs in through Supabase Auth.
2. Server verifies an active `profiles` row, at least one `user_roles` record, and active room-type scope.
3. A forced password change routes to `/change-password`; otherwise `defaultWorkspacePath` selects an authorized workspace.
4. Database RLS/RPC rules remain the authorization boundary; UI routing is not relied on alone.

### Personnel edit

1. Admin begins an operation with expected profile version and requested payload.
2. `begin_personnel_update` locks out competing active operations for the target profile and stores a short-lived operation record.
3. The external Auth change is performed in the application’s privileged path.
4. `commit_personnel_update` validates actor ownership/expiry, consumes the operation, sets a transaction-local guard, and calls the protected profile/RBAC update path.
5. Failure is preserved as reconciliation state rather than silently discarding the cross-system inconsistency.

### Password operation

1. Authorized personnel manager or root reserves an operation for an eligible email-password account.
2. The database records pre-call Auth password-hash evidence without retaining plaintext password material.
3. Service-only transition records the Auth update attempt and result.
4. The durable operation reaches committed, failure, reconciliation, resolved, or rolled-back terminal/recovery state; audit entries identify target, actor, action, and result.

## State model

`reserved → auth_update_started → auth_updated → committed`

Failure/recovery path: `auth_failed | reconciliation_required → resolved | rolled_back`.

A partial unique index permits one active password operation per target user. Personnel edit operations use an expiry and target-specific in-progress lock.

## Audit and risk notes

- Profile and role changes have audit triggers in the base schema.
- Password operations preserve reconciliation evidence and forbid browser submission of password/provider tokens to the durable operation endpoint.
- **Technical risk:** `private.assert_personnel_password_operation_service` uses `auth.role()` to identify service context. The project should validate this against the installed Supabase runtime and current RLS guidance before changing it; no policy behavior was inferred or modified in this audit.
- **Live dependency:** identity-provider failures and reconciliation jobs require an integration environment to prove recovery behavior end-to-end.
