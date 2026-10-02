# Workflow evidence cross-check

## Liam relationship evidence

The on-demand Liam artifact (`docs/erd/liam/`) represents 30 tables, 331 columns, 30 primary keys, and 64 foreign keys. It was used only to support these workflow conclusions:

| Workflow conclusion | Supporting relationship |
| --- | --- |
| Equipment request is linked to the scheduling source | `equipment_requests.class_schedule_id → class_schedules.id` (`ON DELETE RESTRICT` in the normalized source model) |
| Equipment request owns its items | `equipment_request_items.request_id → equipment_requests.id` |
| Basic Medical execution has separate registration/session/evidence records | registration → session → schedule; confirmation/check/condition-log relationships |
| Personnel operations retain actor/target relationships | personnel operation and audit tables reference `profiles` |
| Notifications are durable workflow records | request/basic-medical mutations enqueue outbox/notification records rather than relying solely on browser state |

Migrations and declarative schema remain the authority. Liam was not used to infer policy.

## GitNexus evidence

- GitNexus recognizes `eiu-medlabs` as the indexed repository (535 files, 3,845 symbols, 300 stored processes at index time).
- Repository process listing identifies cross-community flows around personnel, imports, scheduling, Basic Medical, equipment operations, staff shifts, dashboard, and RBAC helpers.
- Targeted equipment/Basic Medical queries returned no process matches because the GitNexus FTS index reports degraded/missing FTS indexes.
- No `gitnexus analyze --repair-fts` was run: the requested audit is on-demand and must not configure or initiate recurring scans. Direct code, schema, tests, and Liam evidence were used instead.
