# Nightshift project rules (all Claude Code sessions read this)

1. Read docs/STATE.md, then docs/CONTRACT.md, then your brief in docs/briefs/. The CONTRACT is owned by the lead session. Do not edit it; message the lead (or write a note in your final report) if you need a change.
2. NEVER run git init, commit, push or create repos. The user manages git.
3. Only touch files inside your own folder (listed in your brief). Shared files (README, docs, root package.json, spacetime/) belong to the lead.
4. Use the cheat sheets in docs/ref/ and verify against the real CLI when a snippet is marked UNVERIFIED. Do not guess APIs.
5. No em dashes in any text you write. Be direct and short.
6. sudo cannot prompt in this environment. If you need sudo, tell the user the exact command to run in a separate terminal.
7. SpacetimeDB: always pass `--server local`; database `nightshift`; time columns are u64 microseconds; regenerate bindings after schema changes (lead does this).
8. Do not change the module's security rules (warden-only approve and kill, gate-only requestGrant, executor-only consumeGrant). Add tests, not exceptions.
9. When done, report: what you built, how to run it, what you verified vs assumed, and anything blocked.
