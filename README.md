# Nightshift

An AI agent that fixes what breaks while you sleep, with a Lantern that glows when it needs you.

Nightshift watches your devices, heals a short allowlist of simple fixes on its own, verifies each fix with a health check, and rolls back by itself if the check fails. Anything riskier waits for a press on the Lantern, a FREE-WILi wristband that also shows live agent activity, undoes the last change, and cuts everything with one button. Trust is earned: a fix that has worked several times is promoted to run alone.

## Audiences
- IT, campus IT, MSPs and data centers: fewer repetitive installs, patches and troubleshooting hours, with an audit trail and rollback.
- Individuals with several devices: say "make a Manim video" or "clone this repo and deploy it" from a phone and the right machine does it.

## How it works
- Any MCP-capable agent harness (Gemini CLI, Codex CLI, Claude Code) calls the Nightshift gateway to run commands on devices.
- The gateway classifies each command from the device workspace's `policy.yaml` (never from the agent), asks SpacetimeDB for a grant, and either approves it by policy, escalates to the Lantern, or blocks it.
- Executors run a command only while an active grant exists, snapshot state first, and verify after.

## Threat model (say this out loud)
We defend against a fooled or over-eager agent, not a compromised OS.

## Layout
- `spacetime/`   SpacetimeDB TypeScript module (grants, changes, incidents, trust counters, scheduled expiry)
- `hub/`         MCP gateway, policy engine, headless harness launcher
- `agents/`      executors (TypeScript) and `freewili/` Python bridge for the Lantern
- `workspaces/`  per device type: `SKILL.md` runbook and `policy.yaml`
- `ui/`          React dashboard: devices, incident timeline, cost meter, rollback
- `docs/`        CONTRACT (interfaces), PLAN, TODO, SUBMISSION, DEMO_SCRIPT, ref/ (doc digests)

## Stack
SpacetimeDB 2.x (local), Node 22 + TypeScript, MCP TypeScript SDK, Python 3.12 + uv (FREE-WILi OneWili library), adb, Docker, React + Vite, Gemini CLI or Codex CLI as the harness.

## Rules for ourselves
- One scenario, flawless. Anything the 2 minute demo does not show gets cut.
- Every UI animation and LED state comes from a real `event` row.
- Offline first: local SpacetimeDB, USB or hotspot only.
