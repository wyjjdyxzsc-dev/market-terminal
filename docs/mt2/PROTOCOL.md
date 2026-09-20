# Project Meridian — Engineering Protocol

Compact rules for Market Terminal 2.0 (Project Meridian). These rules govern every MT2 checkpoint.
They are derived from the OWNER's canonical engineering protocol; this file is the repository-local
summary, not the full protocol.

## 1. Owner checkpoint authority
- Exactly one checkpoint is authorized per OWNER prompt. Listing or planning later checkpoints
  (in ROADMAP.md or anywhere else) does not authorize them.
- When a checkpoint reaches PASS / PARTIAL / BLOCKED / ROUTING STOP / HUMAN ACTION REQUIRED:
  produce the checkpoint report, update STATE.md, and STOP.

## 2. Factual authority vs instruction authority
- OWNER intent decides what should be built.
- Repository and runtime evidence decide what is currently true.
- When they conflict: REPORT THE DIFFERENCE, then engineer from factual reality toward the
  authorized objective. Ground truth outranks conversation history, old reports, assumptions,
  previous checkpoint narrative, and memory.

## 3. Phase Identity gate
Before material work, state: checkpoint identifier, canonical objective, expected architectural
objects, explicit out-of-scope list, hot-set status (VERIFIED / CLAIM TO VERIFY), and whether the
checkpoint and prompt agree. If they do not agree: STOP.

## 4. Route from zero (owner-controlled routing)
- Verify the actual current model, effort level, and execution mode; do not assume them.
- Classify the checkpoint (BEHAVIORAL / STRUCTURAL / SECURITY-AUTHORITY / DURABLE STATE /
  TEST-ONLY / DOCUMENTATION / MIXED) from the actual work, not from the prompt's guess.
- Use the lowest sufficient configuration. Model and effort are separate dimensions.
- If the required configuration differs from the current one, or is unknown: ROUTING STOP.
  The OWNER performs routing changes. Do not keep working while waiting.
- If work later enters a materially more consequential class: preserve state, re-run routing.

## 5. Git / no-loss
- Never without explicit OWNER authorization: `git reset --hard`, `git clean -fd`, force push,
  destructive checkout/restore, destructive branch or worktree deletion.
- A historical SHA is a reference point, never permission to reset to it.
- Preserve unrelated owner work, legitimate dirty work, partial work, and unknown dirty work
  until it has been classified.

## 6. Truthful execution
- No retroactive fake compliance, no fake execution, no fake acceptance.
- A passing test is evidence, not automatic acceptance. Timeout is not automatically failure.
- Report outcomes as observed. If a step was skipped, say so.

## 7. Durable-state protection
- Protect credentials, user data, private state, caches, KV, push subscriptions, and
  persistent local state. Never commit `.env`.
- docs/mt2/STATE.md is the canonical recovery capsule; conversation history is not state.
  Update STATE.md at every meaningful pause and at checkpoint closure.

## 8. Verification ladder
Use the smallest sufficient progression and scale with risk:
focused check → focused test → subsystem → integration → regression → full suite →
browser/runtime → live → human acceptance.
Test the test: confirm an important test can detect the failure it claims to cover.
Evidence levels (EVIDENCE.md): IMPLEMENTED < UNIT TESTED < INTEGRATION TESTED <
REAL BROWSER TESTED < LIVE TESTED < RESTART VERIFIED < HUMAN ACCEPTED. Never claim a higher
level from a lower one.

## 9. No fake acceptance
Browser acceptance requires an actual browser pass. Production acceptance requires the deployed
runtime to be exercised. Code inspection never substitutes for either.

## 10. Repair rule and failure classification
OBSERVATION → HYPOTHESIS → MINIMAL CHANGE → FOCUSED TEST → OBSERVE → VERIFY.
Never "retry harder". Classify a failure before retrying: IMPLEMENTATION / TEST / ENVIRONMENT /
DEPENDENCY / PERMISSION / CONTEXT / PROCESS / HARNESS / MODEL / EFFORT / ARCHITECTURE / UNKNOWN.

## 11. Latent-bug scope control
Repair a discovered defect inside the active checkpoint only if it blocks baseline correctness,
blocks valid verification, creates immediate safety/data-loss risk, or is clearly part of restoring
a credible existing baseline. Everything else goes to BACKLOG.md. Discovery is not authorization.

## 12. Single-writer discipline
Parallel read-only investigation is allowed when genuinely independent. Shared production files
have exactly one integration writer unless isolation is explicitly proven. No throughput theater.

## 13. Deploy discipline
Production deploys happen only by pushing `main` (GitHub → Cloudflare Workers integration).
Never `wrangler deploy` manually. Never deploy merely to complete a checkpoint. Bump every
`?v=` cache-buster in `public/index.html` on every deploy.

## 14. Checkpoint STOP behavior
At closure update STATE.md, COMMS.md, EVIDENCE.md, BACKLOG.md, and DECISIONS.md where applicable,
emit the checkpoint report in the OWNER's required format, and STOP. Do not begin the next
checkpoint.
