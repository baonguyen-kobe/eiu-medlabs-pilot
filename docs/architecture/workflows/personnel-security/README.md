# Personnel, RBAC, and password-operation workflow

**Risk:** CRITICAL  
**Evidence:** IMPLEMENTED unless marked otherwise.

## Purpose and entry points

Administrators manage personnel profile data, roles, workspace scopes, import permissions, and password recovery/change operations. The design keeps external Supabase Auth updates separate from durable application-side authority records.

Primary code: `app/admin/actions.ts`, `app/login/actions.ts`, `lib/workspace-access.ts`, `lib/personnel-reconciliation.ts`.  
Database authority: `supabase/schemas/01_app.sql`, `02_room_type_scopes.sql`, `05_personnel_authority.sql`, `06_sixth_followup_personnel_and_basic_medical.sql`, `17_personnel_password_and_catalog_batches.sql`, and `20_operations_integrity_master_batch.sql`.

## Main flows

### Authentication and workspace routing

1. User signs in through Supabase Auth.
2. Server verifies an active `profiles` row and at least one `user_roles` record. Workspace permissions use active room-type scopes and the explicit Admin/Staff overrides.
3. A forced password change routes to `/change-password`; otherwise `defaultWorkspacePath` selects an authorized workspace.
4. Database RLS/RPC rules remain the authorization boundary; UI routing is not relied on alone.

### Explicit room-type provisioning

- Creating an Auth user creates a profile, but grants neither an application role nor a room-type scope. `preapproved` and user metadata are not role/scope authority.
- Personnel creation/edit/import supplies explicit roles and scopes; the personnel RPC replaces memberships with exactly the selected room types.
- Non-Admin scoped room/schedule reads require an active profile, an application-role record, and the requested room-type membership. Revoking the last role removes those reads even when the session and membership remain.
- Active Admin retains all-room access without assigned scopes. Staff's Skills workspace navigation override does not grant Nursing room/schedule access without Nursing membership.
- Existing memberships are preserved. The legacy production-directory script has no selected scopes; new non-Admin accounts from it remain unassigned until personnel configuration. Local sample users and Nursing workflow fixtures declare their scopes explicitly.
- Self-profile/membership introspection, room-type metadata, and the active-user course catalog retain their existing policies; they are not a grant to read scoped rooms or schedules.
- Owner-approved cutover: `20261004120000_explicit_profile_room_type_authority.sql` removes the legacy automatic Nursing trigger and adds the application-role requirement to `private.has_room_type()`. No historical migration or existing membership is rewritten.

### Isolated pilot checkpoint — 2026-10-04

**Owner decision: ACCEPTED / CLOSED** at commit `2929440`. Automatic Nursing Role Trigger is closed; retain the approved migration, explicit scope assignment, application-role requirement, Admin override and Staff routing. Keep all three pilot mock memberships and all 522 local legacy memberships. Audit candidates below are deferred information, not a cleanup task or a pilot/P1 blocker. No bulk or exact-row deletion without separate Owner authorization and intended-authority evidence.

- Owner authorized only `kwpyukofofoaqhmxndlc`, migration `20261004120000_explicit_profile_room_type_authority.sql`, targeted remote verification, read-only provenance audit, and conditional pilot delivery. Original/current MedLabs and production were not mutated.
- `RUN AND PASS`: remote dry-run contained exactly that migration, with no seed/role payload; actual history records it. Default trigger/function are absent; authenticated helper execution remains allowed and anonymous execution denied.
- `RUN AND PASS`: real Auth creation/sign-in produced an active profile with zero roles and zero scopes despite role/scope user metadata. An explicitly assigned Nursing member without a role read zero owned rooms/schedules; Lecturer read the Nursing room/schedule but not Basic; last-role revocation denied both reads on the same JWT.
- `RUN AND PASS`: Admin without scopes read both owned room types and the Nursing schedule. Staff without scopes read neither; Basic-only Staff read Basic but not Nursing. Checked-out workspace routing, exercised with the actual remote role/scope states, retained Skills navigation and `/dashboard` for all three Admin/Staff states. This is not hosted-UI or application-deployment evidence.
- Owned verification user, course, rooms, schedule and outbox were removed, and the session signed out. The three existing pilot memberships remained byte-for-byte equivalent under the ordered-row fingerprint `b34cfbe23add7a13b29b03265ee46b0d`.

Read-only audit distinguishes datasets: **522 is the local baseline, not the remote pilot count**.

| Evidence group                                                      | Local memberships | Remote pilot memberships |
| :------------------------------------------------------------------ | ----------------: | -----------------------: |
| Total                                                               |               522 |                        3 |
| Nursing, null creator, assignment timestamp equals profile creation |               515 |                        3 |
| Nursing with a recorded creator                                     |                 1 |                        0 |
| Basic, null creator                                                 |                 6 |                        0 |
| Matching creator/personnel-authority audit at assignment time       |                 0 |                        0 |

- The null-creator Nursing signature is compatible with the former default trigger, but cannot distinguish it from an explicit direct write in the same transaction. `created_by` can also become null after creator deletion. These are provenance candidates, not proven unauthorized grants.
- The three remote rows belong to the already approved synthetic mock identities in `scripts/p1-mock-manifest.sql` (one Admin, two Staff). Their Nursing intent is documented; historical database rows contain no explicit creator/personnel audit. No unknown remote membership was found, and no P1 marker or lifecycle operation was changed.
- Locally, 510 of the 515 default-compatible Nursing rows have roles; 488 are active. Owner review group: **275 active non-Admin users** (226 Staff, 16 Teaching Assistant, 23 Lecturer, 10 Viewer) have unattributed Nursing scope. The remaining role-bearing partition is 213 active Admin users with independent Admin override and 22 inactive users (including five Admin). Five additional rows have no role.
- The single recorded-creator Nursing row names the Staff subject itself (`22e44891-bab8-4245-a606-9e115f82b8f1`), without matching personnel-authority audit. It is an attributed write, not proof of authorized personnel scope selection. Basic rows cannot originate from the Nursing-only default, but their author/approved intent is unrecorded.
- No legacy membership was deleted or rewritten. Local count/fingerprint remained `522` / `b183ffe94b5d93a7baa4755a9efb9f51`. Any cleanup requires Owner identification of intended scopes and separate exact-row authorization; a provenance heuristic alone is insufficient.

### Pilot privileged credential rotation — 2026-10-04

Owner authorized rotation only on `kwpyukofofoaqhmxndlc`; the Nursing authority closure above is not reopened. Modern secret `580cba6d-eabf-4b76-af17-795e37c4f95c` replaces deleted `8ed045dd-6ed0-4ea0-a47f-e2d887b91b41`; legacy API keys disabled and legacy HS256 signer revoked. Existing modern publishable/ES256 keys and account Management PAT unchanged. Current API secret and DB password are in per-user Windows Credential Manager `MedLabs Pilot:kwpyukofofoaqhmxndlc`, never Git/docs/plaintext env files.

- **RUN AND PASS:** old modern/legacy `apikey` values denied HTTP 401; new current SDK Auth Admin/Data resource reads accepted; exact old bearer denied by Data API. DB password reset HTTP 200 and new verified-TLS `postgres` login accepted. No pre-existing client DB sessions, Auth sessions or password-login users were found; no mass session termination or user-password reset occurred.
- **RUN AND PASS:** delayed exact old bearer Auth Admin denial HTTP 403 `bad_jwt` at `2026-10-04T16:38:30.006Z`, same-route new secret HTTP 200; Storage old bearer HTTP 400/body 403 Unauthorized, new secret HTTP 200. Earlier Auth Admin HTTP 200 remains historical evidence; no particular cache/propagation cause is established and no further Auth/signing-key change, explicit restart or restoration was used. DB-password reset is a separate recorded operation.
- **NOT RUN — BLOCKED:** original DB-password negative login; plaintext absent from checked environment, CLI cache, secure stores and retained session. Changed SCRAM verifier is not a substitute.
- No confirmed hosted pilot, pilot GitHub secrets or Edge Functions; internal SQL cron jobs have no API-key consumers. Application `.env.local` stays on the dedicated loopback pilot. Existing three remote memberships and 522 historical local rows are unchanged.

[P1 exact evidence and credential prerequisite](../../P1_MOCK_READINESS.md#bounded-real-opening-gate-and-pilot-rotation--2026-10-04). Exercised API retirement is verified; full rotation closure still requires the securely supplied original DB password for its real negative login. No operational readiness claim.

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
