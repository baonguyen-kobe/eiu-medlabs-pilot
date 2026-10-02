# Import and notification workflows

## Catalog/personnel/schedule imports — HIGH

**Actors:** admin; staff where an explicit scoped permission exists.  
**Entry points:** import pages, administrative catalog pages, import-template/import-error routes.  
**Data:** `import_batches`, `import_rows`, catalog/course/room/profile tables.

The implementation separates preview/validation from application. Error downloads expose only authorized batch rows, classifying rows as `error`, `duplicate`, `conflict`, or `system_error`. Personnel imports normalize identity and role input before privileged application-side identity work. Batch and catalog operations have tests covering conflicts, identity rules, semester authority, and scope.

## Notification outbox — HIGH

Workflow mutations enqueue durable outbox events in the same database transaction. Server actions call pending-outbox processing through Next `after()`. Recovery endpoints require a bearer secret and call the same recovery/process functions. Tables include `email_outbox_events`, `email_notifications`, and `email_delivery_settings`.

**Evidence limits:** durable enqueue and authorization are implemented. Actual provider delivery, retry timing, and failure recovery require a configured external integration environment; those outcomes are INFERRED, not asserted by this audit.
