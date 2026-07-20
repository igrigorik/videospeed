# Speed Arbitration: the contract

This document is the authoritative specification for how VSC decides what
`video.playbackRate` should be. Every PR that changes speed behavior must
identify which cell(s) of the transition table it changes and why. The
machine-checked version of this contract lives in `specs/SpeedArbiter.tla`;
the two must be kept in sync (they are two notations for the same object).

## Why this document exists

`video.playbackRate` is a single shared register with four writers:

1. the user, through VSC (keyboard shortcuts, controller UI, popup)
2. the user, through the site's native controls (YouTube's speed menu,
   `<`/`>` keys, click-hold 2x, Chrome's built-in `<video>` context menu)
3. the site's scripts, autonomously (player init, ad transitions, stream
   switches, seek-resets, Bitmovin's reset-on-resume)
4. VSC itself, reactively (fight-back, lifecycle restore on `play`/`seeked`)

The DOM provides **no provenance**: a `ratechange` event does not say who
wrote the register or why. Everything VSC does is therefore an _arbitration_
problem — maintain a desired state (or an explicit lack of one), observe
divergence, and decide per divergence: **accept**, **enforce**, or **ignore**.

Historically that decision logic was distributed across `event-manager.js`
(gesture window, fight-back, cooldown), `video-controller.js` (lifecycle
restore), `settings.js` (`lastSpeed = null` semantics), and site handlers.
Nearly every speed bug in the tracker is the same failure mode: two modules
disagreeing about the invariant. This document exists to make that class of
bug structurally impossible: one table, one owner per decision.

## Architecture: classifier vs. arbiter

The system splits into two components with different epistemic status:

**Intent classification — heuristic, empirical, unverifiable.** Given an
external ratechange, was it (a) user intent expressed through native site
controls, (b) an autonomous site action, or (c) initialization noise?
This is inference from side channels: gesture timestamps, key identity,
pointer state, `readyState`, per-site knowledge. It cannot be proven
correct — sites change. All such heuristics live in the classifier and
ONLY in the classifier, each annotated with the issue that motivated it.
Site handlers may extend the classifier (e.g. YouTube's handler knows its
own seek-reset signature).

**Arbitration — pure, small, verified.** _Given_ a classification, what do
we do? A total function over a small state space:

```
step(state, event) -> (state', effects[])
```

No DOM access, no timers (timer expirations arrive as events), no storage
calls (persistence is an emitted effect). This is the part the transition
table below specifies and the TLA+ model checks.

The safety story for the split: the arbiter is correct by construction;
the classifier is correct by evidence; and the arbiter guarantees that
classifier mistakes are **recoverable** — a misclassification can never
permanently lock the user out (one user action through VSC always
re-establishes authority) and can never cause writes in `NO_OPINION` mode.

## Arbiter state

| Field        | Domain                                     | Meaning                                                  |
| ------------ | ------------------------------------------ | -------------------------------------------------------- |
| `mode`       | `NO_OPINION` \| `HOLDING` \| `SURRENDERED` | Whether VSC currently claims authority over the rate     |
| `desired`    | speed \| none                              | The authoritative target. Non-none iff `mode = HOLDING`  |
| `fightCount` | 0..MAX_FIGHT                               | Consecutive autonomous resets we have fought this window |

Correspondence to today's code: `desired` is `settings.lastSpeed`
(`null` = none), except under a site rule — see finding F5. `mode` is
implicit today (derived from `lastSpeed === null`), which is part of why
the lifecycle and ratechange paths could disagree.

State the arbiter does _not_ own: the evidence ledger
(`lastUserInteractionAt`, click-held flag, key identity) belongs to the
classifier; persisted storage belongs to the effects layer.

## Event alphabet

| Event                 | Source                                      | Notes                                                    |
| --------------------- | ------------------------------------------- | -------------------------------------------------------- |
| `USER_VSC_SET(v)`     | VSC UI / shortcuts / popup                  | The only unambiguous input in the system                 |
| `EXT_RATE(v, class)`  | ratechange listener, after classification   | `class ∈ {USER_INTENT, AUTONOMOUS, INIT_NOISE}`          |
| `LIFECYCLE`           | `play`, `seeked`, deferred `loadedmetadata` | Player lifecycle moments where sites commonly reset rate |
| `FIGHT_WINDOW_EXPIRE` | timer                                       | Quiet period elapsed; forgive past fights                |
| `LOAD(init)`          | settings load                               | Establishes initial mode (see below)                     |

Self-originated ratechange echoes (our own `playbackRate` writes) are
filtered before classification by the cooldown + `detail.origin` check —
that filtering is classifier/adapter duty; the arbiter never sees them.

## Effects vocabulary

| Effect       | Meaning                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `WRITE(v)`   | Set `video.playbackRate = v` (via site handler)                                                |
| `PERSIST(v)` | Update in-memory `lastSpeed` AND schedule debounced storage write (subject to `rememberSpeed`) |
| `SYNC_UI(v)` | Update the speed indicator only                                                                |
| —            | No effect                                                                                      |

`PERSIST` is atomic by contract: in-memory and storage move together or
not at all. (Today they can diverge — finding F1.)

## Initial mode (LOAD)

Priority at page load:

1. Per-site rule configured → `HOLDING(ruleSpeed)` — the rule is initial
   authority; thereafter the normal machine applies (see F5 — this is a
   deliberate change from current behavior).
2. `rememberSpeed = on` and stored `lastSpeed` present → `HOLDING(stored)`
3. Otherwise → `NO_OPINION`

## The transition table (target contract)

| #   | State       | Event                                       | Effects                | Next state  | Rationale / provenance                                                                                                                                                                                                 |
| --- | ----------- | ------------------------------------------- | ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | NO_OPINION  | LIFECYCLE                                   | —                      | NO_OPINION  | **No opinion ⇒ no writes.** Was buggy (wrote 1.0 baseline): #1537, PR #1537                                                                                                                                            |
| 2   | NO_OPINION  | EXT_RATE(v, USER_INTENT)                    | PERSIST(v)             | HOLDING(v)  | User spoke through native controls; adopt. Today not adopted (gesture path gated on truthy `lastSpeed`) — design decision, resolves the #1532 sub-question                                                             |
| 3   | NO_OPINION  | EXT_RATE(v, AUTONOMOUS)                     | SYNC_UI(v)             | NO_OPINION  | Site owns the rate; we display it                                                                                                                                                                                      |
| 4   | NO_OPINION  | EXT_RATE(v, INIT_NOISE)                     | —                      | NO_OPINION  | readyState<1 noise, min-rate glitches                                                                                                                                                                                  |
| 5   | NO_OPINION  | USER_VSC_SET(v)                             | WRITE(v), PERSIST(v)   | HOLDING(v)  | User claims authority                                                                                                                                                                                                  |
| 6   | HOLDING(d)  | LIFECYCLE                                   | WRITE(d)               | HOLDING(d)  | Re-assert; **no PERSIST** (#1494)                                                                                                                                                                                      |
| 7   | HOLDING(d)  | EXT_RATE(v, USER_INTENT)                    | PERSIST(v)             | HOLDING(v)  | Accept native-control change as the new authority. Fails today via _misclassification_, not bad arbitration: #1554/#1555 (click-hold), #1562/#1546/#1563 (arrow-key false positive), #1581 (click-seek false positive) |
| 8   | HOLDING(d)  | EXT_RATE(v≠d, AUTONOMOUS), fightCount < MAX | WRITE(d), fightCount++ | HOLDING(d)  | Fight back (bounded)                                                                                                                                                                                                   |
| 9   | HOLDING(d)  | EXT_RATE(v≠d, AUTONOMOUS), fightCount = MAX | SYNC_UI(v)             | SURRENDERED | Give up **and stand down** — authority is dropped, not retained (F2; today authority is silently kept and the war restarts every quiet window)                                                                         |
| 10  | HOLDING(d)  | EXT_RATE(d, AUTONOMOUS)                     | —                      | HOLDING(d)  | Site confirmed our value                                                                                                                                                                                               |
| 11  | HOLDING(d)  | EXT_RATE(v, INIT_NOISE)                     | —                      | HOLDING(d)  | Ignore                                                                                                                                                                                                                 |
| 12  | HOLDING(d)  | USER_VSC_SET(v)                             | WRITE(v), PERSIST(v)   | HOLDING(v)  |                                                                                                                                                                                                                        |
| 13  | HOLDING(d)  | FIGHT_WINDOW_EXPIRE                         | fightCount := 0        | HOLDING(d)  | Forgive isolated resets                                                                                                                                                                                                |
| 14  | SURRENDERED | LIFECYCLE                                   | —                      | SURRENDERED | We stood down; stay down                                                                                                                                                                                               |
| 15  | SURRENDERED | EXT_RATE(v, any)                            | SYNC_UI(v)             | SURRENDERED | Observe only                                                                                                                                                                                                           |
| 16  | SURRENDERED | USER_VSC_SET(v)                             | WRITE(v), PERSIST(v)   | HOLDING(v)  | Only the user can restart the war                                                                                                                                                                                      |

Every cell is total: any (state, event) pair not listed above is a spec
bug, not an implementation choice.

## Invariants

Checked by TLC over `specs/SpeedArbiter.tla`; conformance tests replay
TLC traces against the JS `step()` implementation (planned).

- **I1 — No-opinion invariance.** In `NO_OPINION`, the arbiter never
  emits `WRITE`. (#1537 was a violation of exactly this.)
- **I2 — Persistence purity.** `PERSIST` is emitted only on
  `USER_VSC_SET` or `EXT_RATE(_, USER_INTENT)`. Lifecycle restores and
  fight-backs never persist. (#1494; F1 is today's violation.)
- **I3 — Bounded fighting.** Per autonomous site write, the arbiter
  emits at most one `WRITE`; per fight window, at most `MAX_FIGHT`.
  No livelock against a site that fights back.
- **I4 — Convergence.** If the site stops writing and no observation is
  pending, `HOLDING(d)` implies `playbackRate = d`.
- **I5 — Mode–desired coupling.** `desired ≠ none ⇔ mode = HOLDING`.
- **I6 — Recoverability.** From any state, a single `USER_VSC_SET(v)`
  yields `HOLDING(v)` with rate `v` — no classifier mistake can lock the
  user out.

## Findings surfaced by writing this spec

Deviations of current `master` from the target contract, beyond the
already-tracked issues:

- **F1 — init-persist asymmetry (latent bug, unreported).**
  `action-handler.js setSpeed()` step 1 excludes sources `external` AND
  `init` from updating in-memory `lastSpeed`, but step 6 excludes only
  `external` from the storage write. A lifecycle restore
  (`source:'init'`) with `rememberSpeed=on` therefore persists the
  restored value to storage while in-memory state says "no opinion."
  Concrete damage: with a per-site rule (`siteDefaultSpeed=1.25`) and a
  remembered global speed of 1.8, every `play` event on the ruled site
  silently overwrites the stored 1.8 with 1.25 — and the storage-change
  listener propagates that to every other open tab (a second vector for
  #1559 beyond user actions). Violates I2.
  **Full extent (found by the differential harness):** `config.save()`
  merges into in-memory settings immediately (`settings.js:220`), so
  step 6 ALSO sets in-memory `lastSpeed` — defeating step 1's `init`
  guard entirely whenever `rememberSpeed` is on. The forced baseline
  silently _becomes fightable authority_ with zero user action: under a
  site rule, F5's "no fight-back" holds only until the first `play`,
  after which the system has self-mutated into holding the rule speed.
- **F2 — surrender is shallow.** On surrender the code accepts the
  site's rate with `source:'external'`, which does NOT update
  `lastSpeed`. Authority is silently retained, so after the next quiet
  window the fight restarts: fight ×5 → surrender → quiet → fight ×5 →
  … forever, for as long as the site keeps enforcing its own rate. On
  sites that periodically re-assert rate (live players), this is a
  permanent periodic write/event storm. Plausibly the mechanism behind
  the periodic CPU spikes in #1587 and the YouTube UI degradation in
  #1556 — unconfirmed, but the spec predicts exactly a periodic
  signature. Target: rule 9 (drop authority on surrender).
- **F3 — no adoption without prior authority.** The gesture-acceptance
  branch in `handleRateChange` is gated on truthy `lastSpeed`, so in
  `NO_OPINION` a genuine native-menu change is never adopted (synced to
  UI only, never persisted). Target: rule 2. (This was the legitimate
  half of PR #1532.)
- **F4 — gesture ledger is per-document, not per-video.** A click
  anywhere blesses a ratechange on _any_ video in the document within
  the window. On multi-video pages an autonomous reset on video B can
  be accepted because the user clicked near video A. Classifier-side
  fix: scope evidence to the event's target video where possible.
- **F5 — site rules create a fourth, incoherent authority state.**
  Under a site rule, `lastSpeed` is `null` but `getTargetSpeed()`
  returns the rule speed: lifecycle events DO enforce the rule, while
  ratechange fight-back and gesture acceptance are DISABLED (both gate
  on truthy `lastSpeed`). Net behavior: the site can change speed
  freely, but any pause/seek snaps back to the rule — and native user
  changes are accepted then reverted on the next play. This is a
  coherent-looking mechanism for several "speed resets on pause/resume"
  reports (#1573, #1551 are candidates). Target: a rule is _initial_
  authority (`HOLDING(ruleSpeed)` at LOAD), after which the uniform
  machine applies.

## Classifier heuristics (current + pending)

Every heuristic must cite its motivating evidence. Current inventory:

| Signal                                      | Classification effect                                                                                                                                                                                                   | Provenance            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Unhandled keydown                           | today: any key arms USER_INTENT window — **false-positives on arrow-key seek**; target: only `<`/`>` (Shift+Comma/Period) arm it                                                                                        | #1562/#1546, PR #1563 |
| Click (capture, outside vsc-controller)     | arms USER_INTENT window — **false-positives on progress-bar clicks** (#1581); needs narrowing, but DOM-heuristic matching of "speed-looking" elements (PR #1532) is too fragile — prefer per-site classifier extensions | #1521, #1581          |
| Pointer held down                           | click-hold arms USER_INTENT for the duration of the hold                                                                                                                                                                | #1554, PR #1555       |
| `detail.origin === 'videoSpeed'` + cooldown | self-echo → filtered before arbiter                                                                                                                                                                                     | existing              |
| `readyState < 1`                            | INIT_NOISE                                                                                                                                                                                                              | existing              |
| `rate ≤ SPEED_LIMITS.MIN`                   | INIT_NOISE                                                                                                                                                                                                              | existing              |
| Default (no evidence)                       | AUTONOMOUS                                                                                                                                                                                                              | existing              |

## Migration plan

1. This document + `specs/SpeedArbiter.tla` reviewed and agreed (spec
   before code).
2. Pure `speed-arbiter.js` implementing `step()`, with a conformance
   suite generated from TLC's reachable-state graph (every transition
   edge becomes a test), alongside the existing unit tests.
3. Strangler-fig: `event-manager.js` and `video-controller.js` delegate
   decisions to the arbiter; they become adapters (DOM in → classified
   event → arbiter → effects out). Behavior change should be zero
   except cells deliberately fixed (1, 2, 9; F1, F5).
4. Pending PRs #1563 and #1555 land as classifier changes referencing
   the table.
5. Multi-tab semantics (#1559) specified as an explicit extension —
   today's cross-tab bleed is an accident of shared storage, not a
   decision; the spec forces the decision.

## Verification status

Three independent layers, all runnable locally:

1. **TLC over `specs/SpeedArbiter.tla`** — target contract exhaustively
   checked (582 states); two single-defect configs reproduce #1537 and
   F1 as property violations with minimal traces. Design-time oracle.
2. **Mini model checker in `tests/unit/core/arbiter.test.js`** —
   exhaustive BFS over the reachable (state × register) graph asserting
   invariants I1–I6 on every edge; runs in vitest, no Java needed.
3. **Differential harness + bug ledger in
   `tests/integration/arbiter-differential.test.js`** — the same
   scenario streams drive the real legacy modules and the
   legacy-flagged arbiter; observables must match at every step
   (hand scenarios + a 20-seed deterministic random sweep). The bug
   ledger pins every known bug (open and resolved): each REPRODUCES
   under legacy configuration in both worlds and VANISHES under the
   target contract — except #1581, honestly pinned as an open
   classifier gap. Fight-budget note: legacy increments-then-checks, so
   `MAX_FIGHT_COUNT = 5` yields 4 fight-backs; the arbiter's default
   budget preserves that observable behavior.

Consequence: the strangler-fig rewire can land with all compat flags in
legacy position as a provably behavior-preserving change, and each
contract fix ships as a one-flag diff whose effect is already
demonstrated by a ledger entry. Remaining debates are about which
behavior we want per cell — never about implementation correctness.

## Model checking

```
cd specs
java -jar tla2tools.jar -config SpeedArbiter.cfg SpeedArbiter.tla          # target contract: all green
java -jar tla2tools.jar -config SpeedArbiterBuggy1537.cfg SpeedArbiter.tla # reproduces #1537 (I1 violation)
java -jar tla2tools.jar -config SpeedArbiterBuggyPersist.cfg SpeedArbiter.tla # reproduces F1 (I2 violation)
```

The two "buggy" configurations enable single-defect flags that model
today's behavior for cells 1 and 6 respectively; TLC produces minimal
counterexample traces, which double as regression documentation.
