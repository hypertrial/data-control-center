---
name: pad
description: "Talk to your project. Natural-language project management — create items, check status, create plans, brainstorm ideas, and more."
---

# Pad — Talk to Your Project

Use Pad when the user discusses project work: issues, tasks, plans, ideas,
progress, dependencies, conventions, roles, standups, or retrospectives.

## Load context once per conversation

Before the first Pad action in a conversation, run `pad bootstrap --format json`.
Reuse that context for later Pad turns in the same workspace. Refresh it only
after switching workspaces, after changing collections/conventions/roles/playbooks,
when Pad reports stale schema/context, or when the user asks for a refresh. Use a
targeted item or dashboard read for changing work state; do not rerun bootstrap
just because the skill was invoked again.

- If `pad` is missing, ask the user to install it or add it to PATH.
- If bootstrap fails, run `pad agent guide context-loading` and follow that
  section. Never initialize authentication blindly.
- In Codex, keep `pad` as a direct command. Shell redirection such as
  `< file` can prevent a narrow Pad execution rule from matching. For
  `--stdin`, stream the body through the process's stdin; if the harness
  cannot do that, request narrowly scoped permission to run Pad with loopback access.
- An underlying `operation not permitted` means the health probe was
  sandbox-blocked, not that Pad is down. Retry the same direct command with loopback
  permission, and do not repeat an ambiguous write until its result is checked.
- Follow every body in `conventions`. Before meaningful work, inspect
  `convention_index` and load bodies for the matching trigger.
- If `needs_onboarding` is true, offer setup and wait for consent.
- If roles exist and none was chosen in this conversation, ask once; do not block
  if the user declines.

## Act safely

- Use issue IDs such as `TASK-5`, never slugs.
- Read an item before updating it. Send only changed fields and include a comment
  with status changes.
- Read collection schemas instead of guessing field names or terminal statuses.
- Confirm each mutation from the returned object before saying it succeeded.
- Use active playbooks when intent or an invocation slug matches; never run draft
  or deprecated playbooks unless the user explicitly asks.
- Prefer summary reads and bounded lists. Fetch full bodies only when needed.

## Common commands

```bash
pad project dashboard --format json
pad item show TASK-5 --agent
pad item list [collection] --format json
pad item create <collection> "Title" [flags]
pad item update TASK-5 [flags]
pad item comment TASK-5 "Message"
pad playbook list --format json
pad playbook show <slug> --format markdown
```

Use `pad <group> <command> --help` for exact flags.

## Load details only when needed

```bash
pad agent guide                         # list available topics
pad agent guide items                   # item commands and contracts
pad agent guide before-performing-work  # convention routing
pad agent guide role-awareness          # role behavior
pad agent guide multi-step-workflows    # planning, ideation, retro, onboarding
pad agent guide all                     # explicit full reference
```
