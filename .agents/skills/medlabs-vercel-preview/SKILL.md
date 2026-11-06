---
name: medlabs-vercel-preview
description: Preview-only Vercel workflow for MedLabs rendered and user validation. It never authorizes production deployment, production aliases, production database mutation, merge, or implicit Git push.
---

# MedLabs Vercel Preview

## Scope

This skill is PREVIEW ONLY.

Use it only when the active task explicitly authorizes a Vercel Preview.

## Preconditions

Before any preview deployment:

1. identify the current Git branch;
2. identify the exact source SHA;
3. verify the linkage is the pilot project `eiu-medlabs-pilot`, never the original
   application's Vercel project;
4. verify that no production deployment flag or production alias operation is
   present.

## Allowed

An explicitly authorized Vercel Preview deployment for rendered, responsive,
accessibility, or user visual validation.

## Forbidden

Never:

- use `--prod`;
- assign or change a production alias;
- merge branches;
- implicitly Git push;
- mutate Supabase production;
- modify production environment variables;
- describe preview state as production truth.

## Result

Report:

- source Git SHA;
- preview URL;
- rendered validation actually performed.

Preview evidence does not prove production state.
