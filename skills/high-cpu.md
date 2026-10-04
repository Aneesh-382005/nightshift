---
slug: high-cpu
title: A process is using too much CPU
category: performance
tags: cpu, load, slow, performance, busy, process, runaway
runbook:
risk: ask
---
# One process eats the CPU, so find it and ask a human. No automatic fix yet.

## Symptoms
- The service answers slowly or times out, `/health` is flaky.
- Load average is high.

## Check
Read-only, allowed on the linux-server read list:
- `uptime`
- `ps`
- `free`
- `health`
- `tail -n 20 /var/log/app/app.log`

## Fix
No automatic fix yet. There is no allowlisted runbook for this. Killing or restarting a process is a write that needs a physical press, and the agent should say which process and why before asking.
A normal `restart-web` may help only if the busy process is the web service itself, and it still asks first.

## Rollback
Nothing runs automatically, so nothing to roll back. A press-approved restart is undone like any other change.

## Do not
- Do not `kill -9` anything, especially process 1 or the supervisor.
- Do not reboot.
- Do not restart in a loop, the circuit breaker stops it after two failures.
