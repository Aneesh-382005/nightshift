---
slug: web-service-down
title: Web service is down
category: service
tags: service, down, health, 503, restart, not responding, web, http
runbook: restart-web
risk: safe
---
# The web service stopped answering /health, so restart it and check it comes back.

## Symptoms
- Monitor alert: "service down: /health not responding".
- `health` exits non-zero and the status page says DOWN.

## Check
Read-only, all on the workspace read list:
- `svc status web`
- `health`
- `tail -n 20 /var/log/app/app.log`
- `ps`

## Fix
Run the runbook `restart-web` (command `svc restart web`). It only restarts the one service, takes a snapshot of its state first, and checks `health` afterwards. A restart is reversible in the sense that the executor can put the service back into the state it was in before.
New runbooks start at "ask" (one press). After 3 verified successes it heals alone.

## Rollback
If `health` still fails, the executor restores the snapshot state automatically and records the rollback. The Lantern gray button also undoes the last change.

## Do not
- Do not reboot the machine or kill the supervisor (forbidden by policy).
- Do not use `systemctl` or `service` on the stand-ins, use `svc` only.
- Do not retry more than twice: two failed fixes trip the circuit breaker and escalate to a human.
