# Application language switch

Owner correction on 2026-10-28: use an explicit VI/EN switch across the entire
application, default Vietnamese, rather than displaying both languages together.

Use a strict preference cookie, a shared React provider and explicit static UI
translations. Initialize server rendering and hydration with the same locale.
Do not key/remount pages, reload the document, change route prefixes or rewrite
DOM text. Translate RSC text explicitly and preserve client form state.

Scope: shared shell, authentication, Skills schedules/requests/preparation/
fulfillment/imports, Basic Medical, personnel, shifts and Inventory including
visible labels, options, notices, validation, accessible names and loading/error
states. Existing bilingual copy must select one language.

Preserve user-entered and persisted content, historical evidence, permissions,
RPC payloads, retries, parsing contracts and HCM business timezone. This is a UI
change; database migrations and production deployment are outside this change.
Generated PDFs/emails and import template formats retain their existing business
contracts; do not translate stored historical content.

Verification: strict default/invalid-cookie behavior, SSR/hydration, language
persistence, no raw bilingual labels in supported UI, unchanged names/data,
and switching with draft/filter/uncertain state intact. Build/type/lint and
impacted tests; browser walkthrough across representative application families.
Keep visual status VERIFY pending owner review.
