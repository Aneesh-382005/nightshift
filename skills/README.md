# skills/

One markdown file per known IT problem. The hub reads this folder and syncs it into the public SpacetimeDB table `skill` (slug, title, category, tags, summary, body, runbook, risk, source, uses, updatedAtUs), so the dashboard and the agent can search it.

## Format
```
---
slug: web-service-down          (file name without .md)
title: Web service is down
category: service|disk|config|files|network|mobile|security|performance
tags: comma, separated, search, words
runbook: restart-web            (a named fix that exists in workspaces/*/policy.yaml, or empty)
risk: safe|ask|hold
---
# One-sentence summary            -> becomes `summary`
## Symptoms
## Check      exact read-only commands, only ones on the workspace read lists
## Fix        the named runbook and why it is reversible, or "No automatic fix yet."
## Rollback
## Do not     what never to do
```
The whole markdown after the frontmatter is the `body`.

## Rules
- Only commands that really exist in our targets and in `workspaces/*/policy.yaml`. No invented commands.
- `risk` is the fix's own risk. `safe` runbooks still start at "ask" (one press) and heal alone after 3 verified successes.
- `risk: hold` and an empty `runbook` mean knowledge only, a human decides.
- Plain English, no em dashes, under 40 lines.

## Files
| slug | runbook | risk |
|---|---|---|
| web-service-down | restart-web | safe |
| bad-config | restore-config | safe |
| disk-full | rotate-logs | safe |
| app-folder-missing | restore-app-dir (restore-folder on host and laptop) | safe |
| phone-wifi-off | wifi-enable | safe |
| phone-wifi-flapping | wifi-bounce | safe |
| poisoned-log-instruction | none | hold |
| high-cpu | none, no automatic fix yet | ask |
| certificate-expiry | none, no automatic fix yet | hold |
| permission-denied | none, no automatic fix yet | ask |
