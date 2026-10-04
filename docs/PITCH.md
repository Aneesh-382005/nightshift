# Pitch kit (lead-owned). Say only what TRACKER.md marks VERIFIED.

## 20-second opener
"It's 3 a.m. A server goes down. Nobody wakes up, and it fixes itself. Nightshift is an AI agent that heals the safe things alone, asks you before anything risky, can undo any change, and answers to a wristband you can feel. Sleep. Nightshift's on."

## 2-minute spoken script (matches the demo)
1. (0:00) "Go to sleep." Dashboard: night garden, everything in bloom.
2. (0:10) Break web-1. "A service just died. Nightshift read the logs and wants to restart it. The first time, it asks." Lantern glows amber. Press green. "Fixed. Health check passed. Trust: one of three."
3. (0:40) Repeat twice, quick cuts. "Three safe fixes and it earns the right to do this alone."
4. (1:05) Break it again. "Now it heals alone. The Lantern just shows what happened." Green.
5. (1:20) Poisoned log line. "Here a log line tries to trick the agent into deleting files. The model is fooled in this test on purpose. The gate does not care what the model thinks. Blocked, nothing ran, no press needed."
6. (1:40) Delete a folder by hand in the sandbox. "Restored from a snapshot."
7. (1:55) Phone Wi-Fi fault, phone mirrored. "A real phone, fixed by the same layer."
8. (2:05) Gray to undo. Double shake: "Kill switch. Everything revoked."
9. (2:15) Press "Make my morning video": "While you slept..." plays on the phone. Show the cost: "a cent a fix, measured over a few runs."

## The AI, in plain words (say this out loud)
- It is an agent, not a script: given a vague alert ("web-1 is unhealthy") it reads the health output, the log tail, disk usage and the folder listing, forms a one-sentence diagnosis, and picks one fix from the runbook. The mystery fault proves it: nobody tells it what broke.
- It reasons live: before each action it says what it is thinking (shown on the dashboard), and every decision the gate makes comes with a plain-English reason.
- It is bounded: the model proposes, the policy gate decides. A fooled model cannot run `rm -rf`.
- It learns trust from outcomes: three verified fixes promote a runbook from "ask" to "alone"; failures stop autonomy.
- It routes models: Gemini through our own loop (about 3,000 to 6,000 tokens a fix), falling back to a local model on the laptop GPU when the cloud is out of quota or offline.
- It answers questions: ask "why is web-1 slow?" and it investigates read-only and replies with evidence.

## How rollback works (be able to say this)
Before any write, the executor snapshots the exact thing it will change (a file's contents, a folder with checksums, a service's state, an Android setting) and records an inverse command in the change table. After the fix it runs a health check. If the check fails, it runs the inverse by itself and marks the change rolled back. The gray button runs the same inverse on demand. Things with no safe inverse (arbitrary commands) are marked irreversible and never run alone.

## Where SSH, RDP and VNC fit (honest)
Today executors speak docker exec, adb and local shell, and devices dial OUT to the database, so no inbound ports are opened on them. An SSH executor is the same gate with a different transport (we are adding one against a throwaway sshd container if time allows). RDP and VNC are screen protocols: an agent would need to see and click, which is a different risk class. Roadmap: the same gate, grants, snapshots and Lantern in front of a screen-use agent. Do not claim RDP or VNC today.

## Tough questions
- "Isn't this PagerDuty or Rootly AI SRE?" Those approve in Slack. We put a physical approval and a kill switch in the loop, earn trust per fix, and work across mixed devices including a phone. Open source and runs offline with a local model.
- "What if the model is fooled?" The agent never touches a device. Every command is classified from a policy file, not by the model. Demo: a fooled test agent is blocked.
- "Why a wristband?" Approvals should be a deliberate physical act you can do half asleep, and the kill switch should not need a laptop.
- "What is real?" Real: the gate, grants, audit trail, rollback, earned trust, the phone, the board. Stand-ins (labelled): containers for servers, the mock alert.
- "Cost?" A few measured runs: about a cent or less per fix with Gemini flash-lite through our own loop. We do not claim fleet savings.
- "Why SpacetimeDB?" Every device, grant and event is a live row; the dashboard, warden and phone all subscribe; identity-checked reducers enforce who can approve or kill; scheduled reducers expire grants.
- "What if the cloud is down?" The loop falls back to a local model on the laptop GPU, and everything else is local.

## B2C line
"The same layer protects your own machines: ask your phone for a recap video, the PC renders it, the phone plays it."

## Closing
"Nightshift works while you sleep. The Lantern makes sure you can sleep."
