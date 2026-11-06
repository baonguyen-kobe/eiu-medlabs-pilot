# MedLabs skills

Read this only when a task matches a row below, then load that skill alone. Skills
guide method; `AGENTS.md` and `docs/DOCUMENTATION_AUTHORITY.md` define behavior.

| Situation                                                                  | Skill in `.agents/skills/`                                                   |
| :------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| Supabase Auth, client, platform, RLS, grants, privileged database behavior | `supabase`                                                                   |
| SQL performance, indexes, locks, schema or migration design                | `supabase-postgres-best-practices` (advisory, after `supabase` for security) |
| React/Next.js implementation or performance                                | `vercel-react-best-practices`                                                |
| Any UI page, component or style work                                       | `medlabs-ui`                                                                 |
| Explicitly authorized Vercel Preview                                       | `medlabs-vercel-preview`                                                     |

Skill additions and upgrades are reviewed changes: add the skill folder, then one
row here and one line below.

## Provenance

- `supabase`: `supabase/agent-skills` `skills/supabase`, adapted with the MedLabs
  repository-first rules; security guidance synced to `c9be0e9`.
- `supabase-postgres-best-practices`: same repository at `8331f91`, adapted with the
  MedLabs security boundary.
- `vercel-react-best-practices`: `vercel-labs/agent-skills`
  `skills/react-best-practices` at `063bee9`, unmodified.
- `medlabs-vercel-preview`: project-authored.
- `medlabs-ui`: project-authored; `references/` copied from the owner's
  `workflow-app-ui` 2026-11-05 (formatting only). UniCouncil product rules are deliberately left out.
