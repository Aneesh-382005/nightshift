---
slug: certificate-expiry
title: A TLS certificate is about to expire
category: security
tags: certificate, tls, ssl, expiry, expired, https, renew
runbook:
risk: hold
---
# A certificate is close to expiring, so warn a human early. No automatic fix yet.

## Symptoms
- Browsers or clients report an expired or untrusted certificate.
- An HTTPS health check fails while plain HTTP works.

## Check
There is no read-only certificate command on any workspace read list yet, and the demo stand-ins serve plain HTTP only. So the agent can run `health` and report the symptom, but cannot read the expiry date itself.

## Fix
No automatic fix yet. Renewing replaces key material and talks to the network, which the sandboxes forbid. This needs a human or a future, reviewed runbook with its own snapshot of the old certificate.

## Rollback
Nothing runs automatically. A future runbook must keep the old certificate and its inverse must put it back.

## Do not
- Do not generate, copy or delete key or certificate files.
- Do not use `curl`, `wget` or `openssl s_client` against outside hosts, network tools are forbidden.
- Do not disable certificate checks to make an alert go away.
