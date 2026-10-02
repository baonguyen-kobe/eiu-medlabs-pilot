---
name: gitnexus-code-intelligence
description: Use GitNexus when exploring unfamiliar architecture, tracing call chains or dependencies, planning cross-file refactors, checking blast radius, understanding API relationships, or validating how changed code affects dependent execution flows. Do not use for trivial isolated edits where the affected file and impact are already obvious.
alwaysApply: false
---

# GitNexus Code Intelligence

Use GitNexus for structural code intelligence, dependency mapping, impact analysis, and cross-file flow validation.

## When to Use GitNexus

### BEFORE Editing
Use GitNexus before editing when:
- Architecture is unfamiliar
- Shared APIs or types are changing
- Database access is shared across modules
- Refactoring spans multiple files
- Route or API contracts change
- Caller or dependency impact is unclear
- Integration between EIU Medlabs and another repository is being planned

### AFTER Editing
Use GitNexus after meaningful cross-file edits when helpful:
- Run `detect_changes` or symbol impact checks to find affected execution flows and identify which targeted verification checks to run.
- Code graphs provide structural dependency intelligence; they do NOT prove runtime correctness or that code is free of defects. Runtime correctness requires targeted behavioral checks.

### Multi-Repository MCP Routing
When the GitNexus MCP instance indexes multiple repositories (check via `list_repos`):
- Always pass `repo: "eiu-medlabs"` (or the exact indexed workspace path if name is ambiguous) explicitly in tool calls.
- Do not assume the MCP server automatically routes to CWD.
- Do not query or modify other repositories unless explicitly requested.
## Targeted Tool Usage

Prefer the smallest necessary operation. Do NOT call all tools.

Available targeted tools:
- `list_repos`: List indexed repositories
- `query`: Search execution flows related to a concept
- `context`: 360-degree view of a single code symbol
- `impact`: Analyze blast radius of changing a symbol
- `trace`: Find shortest execution path between two symbols
- `route_map`: Inspect API route consumers and handlers
- `api_impact`: Pre-change impact report for an API route handler
- `shape_check`: Check response shapes against consumer property accesses

## When NOT to Use GitNexus

Do NOT use GitNexus for:
- Typo fixes
- Isolated label or string changes
- Obvious constants
- Documentation-only edits
- Trivial known-file changes where impact is already clear

## Index Maintenance

If an index refresh is needed, run ONLY:
```powershell
gitnexus analyze --index-only
```
Never refresh using plain `gitnexus analyze` to avoid generating unwanted agent files.
