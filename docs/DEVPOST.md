# Devpost draft (lead-owned). Only claim what is VERIFIED in docs/TRACKER.md.

## Paste-ready fields
Project name: Nightshift
Elevator pitch (182 chars): Earned autonomy for machines: a trust layer that lets AI heal servers and phones while you sleep, asks before risky fixes, undoes any change, and answers to a wristband you can feel.
Thumbnail: docs/img/thumbnail.png (3:2). Gallery: docs/img/architecture.png, dashboard screenshots (dark and light), FREE-WILi photos (IDLE, APPROVE, HEALTHY), Notability screenshots.
Positioning: not "an AI agent". Everyone is building agents that do things; Nightshift is the layer that decides when they are allowed to: policy gate, earned trust, undo, a physical approval device, one gesture to kill.

## Name and tagline
Nightshift. Sleep. Nightshift's on.
An AI agent that fixes what breaks while you sleep, with a Lantern (FREE-WILi) that glows when it needs you.

## Inspiration
It is 3 a.m. and a server goes down. On-call engineers are woken for fixes that are the same restart or config restore every time. But letting an AI act alone on production is scary. We wanted an agent that heals the boring things by itself, asks before anything risky, can always be undone, and cuts off with one gesture.

## What it does
- An agent reads logs and proposes a fix. It never touches a device directly; every command goes through the Nightshift gate, which classifies it from a policy file (never from the agent).
- Autonomy ladder: observe, alone (allowlisted and reversible: snapshot, run, health check, auto-rollback), ask (a press), hold, never (policy forbids it, for example a hostile instruction hidden in a log line).
- Trust is earned: a fix that has worked three times is promoted from "ask" to "alone".
- The Lantern (a FREE-WILi board) shows one word and a color: APPROVE amber, AUTOFIX or HEALTHY green, BLOCKED red, UNDO white. Green approves, blue approves for a shorter time, red denies, gray undoes the last change, yellow shows the last events, and a double shake revokes everything.
- A night-garden dashboard shows every device as a flower, each incident as a plain-English story, earned trust as a growing plant, and the measured cost of a fix. Every light and flower comes from a real database row.
- Works from anywhere: a phone on Tailscale opens the dashboard and approves.

## How we built it
SpacetimeDB is the core: tables for devices, grants, changes, incidents, trust, events and requests; identity-checked reducers (only the warden approves or kills, only the gate requests, only the right executor runs); scheduled reducers for expiry; live subscriptions for the dashboard, warden and phone. An MCP gateway in TypeScript lets any agent plug in. We also built a thin agent loop of our own (Gemini API with a fallback chain to a local model on the GPU), which cut a fix from about 100,000 tokens through a CLI to about 3,000 to 6,000. Executors run on Docker stand-ins, a laptop sandbox and a real Pixel phone over adb. The FREE-WILi bridge is Python (OneWili) with a button stream and an accelerometer shake detector.

## What is real and what is a stand-in
Real: the gate, policy, grants, audit trail, rollback, earned trust, the Pixel phone, the FREE-WILi display, LEDs, buttons and accelerometer. Stand-ins (labelled in the UI): containers standing in for servers, and a mock alert webhook. Sound on the FREE-WILi is off because tones stuck.

## Challenges
FREE-WILi's documented button read did not work on our firmware; we found the button stream route and verified all five buttons. The Gemini CLI silently swapped models, which made cost measurements meaningless, so we wrote our own loop. A model that ignored a poisoned log line did not exercise the gate, so the demo uses a deliberately gullible test agent to show the block.

## Accomplishments
A real wristband press approves a real grant and a double shake revokes it (live test passed). A fix costs a few cents measured over a few runs. 42 policy checks and 12 identity checks.

## What we learned
Safety belongs in a layer the agent cannot talk its way past. Earned trust is a better default than all-or-nothing autonomy.

## What's next
Wireless Lantern over Bluetooth, more device types (Windows, network gear, RDP and VNC), team handoff and on-call presence (multiplayer), hosted dashboard on Spacetime Maincloud.

## Track notes
- Best use of Spacetime: it is the core real-time backend for agent coordination (tables, identities, scheduled reducers, subscriptions).
- Best use of FREE-WILi and Beyond the Code: the board is the approval device, status display and kill switch; without it the human cannot approve or stop the agent physically.
- Actually Intelligent: tool-using agent with a policy gate, earned trust, rollback, a measured cost per fix, model fallback chain including a local model.
- Notability: UI and flow sketched in Notability Pro (add 2 screenshots and tag Notability).

## Built with
SpacetimeDB, TypeScript, Node, MCP, React, Vite, Python, FREE-WILi OneWili, Gemini API, Ollama, Docker, adb, Tailscale, scrcpy.
