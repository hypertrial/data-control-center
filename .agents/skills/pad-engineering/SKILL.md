---
name: pad-engineering
description: Universal Pad engineering orchestration — specify Work and Plans, enforce Ready/Done evidence, run verify wrappers, and hand off without chat history.
---

# Pad Engineering

Use this skill for non-trivial local agentic engineering. Keep Pad's official `pad` skill for CLI/MCP mechanics. This skill overrides routing that would create Ideas or Tasks.

Git owns code. CI owns verification. Pad owns intent, scope, status, dependencies, decisions, evidence, and handoffs.

## Collections

Use only:

- `work` — Feature, Bug, Refactor, Investigation, Maintenance
- `plans` — multi-ticket containers only

Never create Ideas, Tasks, Docs-as-tickets, chores, or extra default types unless the user is explicitly asking for a document. Do not run `onboard`.

Machine status values: `backlog`, `ready`, `in-progress`, `blocked`, `review`, `done`.
Risk: `r0`, `r1`, `r2`, `r3`.

Always pass `--workspace <slug>` from `.pad.toml`. Always reference items by issue ID.

## Ticket body

New Work items MUST start from the canonical Work template. Plans use the Plan template. Required sections must be filled before `ready`. Dependencies are Pad `blocked-by` / `blocks` links, not a prose status field.

Before changing status, lint the ticket:

```bash
python3 -m pad_universal lint --ref WORK-1 --workspace <slug>
```

If the pad-universal package is not on `PYTHONPATH`, run the same linter from the pad-universal checkout. A ticket that fails the linter is not `ready` or `done`.

## Lifecycle

1. Specify until `ready` (playbook `specify`)
2. Reproduce or add failing coverage when practical
3. Implement the smallest coherent change (`implement`)
4. `scripts/verify-fast` then `scripts/verify`
5. Independent adversarial review for r2/r3 (`review`)
6. Fix findings and re-verify
7. Record evidence (`evidence`) or a handoff (`handoff`)

Do not begin material implementation before the ticket is `ready`.

## Routing

- "new feature/bug/refactor/investigation/maintenance" → create Work with the matching `type`
- "plan this" / multi-ticket objective → create Plan, then `decompose` into Work
- "what's ready?" → `pad item list work --status ready --workspace <slug>`
- Do not treat `pad project ready` as the Ready gate
- Status changes always include `--comment` explaining why

## Hard rules

- Do not expand scope silently
- Do not delete or weaken tests to pass verification
- Do not claim checks passed when they were not run
- Do not mark `done` without completion evidence
- Record consequential decisions with `pad item decide`
- Incomplete work needs a handoff a fresh agent can resume
- Follow `PROJECT_AGENT.md` for repository invariants
