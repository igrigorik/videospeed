# Speed arbitration contract

This document defines how VSC currently arbitrates `HTMLMediaElement.playbackRate` when the user, a site player, and VSC can all write it. It is the implementation and verification contract for speed behavior; changes must name the affected transition(s), tests, and formal-model impact.

The machine-checked abstraction is [`specs/SpeedArbiter.tla`](../specs/SpeedArbiter.tla). It deliberately models two controlled media elements, because a one-register model cannot establish that a hostile player A leaves player B usable.

## Scope and non-goals

A `SpeedArbitration` instance is scoped to one injected document/frame, not an entire browser tab across frames.

`config.settings.lastSpeed` remains one document/session-wide desired speed. This preserves the extension's existing shared-speed and persistence behavior; VSC does not add a persistent per-video speed preference or storage schema.

Conflict handling is per media element. A site can fight, locally surrender, or use its one quiet-war re-arm on A without consuming B's budget, cancelling B's timer, or clearing the shared desired speed.

The contract does not prove that a site gesture really meant “set speed.” The classifier is intentionally heuristic. The arbiter instead guarantees bounded, recoverable behavior for every classifier verdict.

## State ownership

| State                                                                            | Owner                              | Scope                                                    | Purpose                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `lastSpeed`                                                                      | `VideoSpeedConfig`                 | document/session                                         | Shared desired authority; `null` means VSC has no opinion                           |
| `authorityEpoch`                                                                 | `SpeedArbitration`                 | document/session                                         | Invalidates stale local conflict records after a fresh user choice                  |
| `mode`, `fightCount`, `warQuiet`, `rearmBudget`, temporary override, fight timer | `SpeedArbitration` conflict record | one `HTMLMediaElement`                                   | Local fight/surrender/re-arm state plus native temporary hold overlay               |
| terminal release fallback timer                                                  | `SpeedArbitration`                 | one `HTMLMediaElement`                                   | Recover from a retired physical hold that never emits a normal release `ratechange` |
| write-token queue                                                                | `SpeedArbitration.pendingWrites`   | one `HTMLMediaElement`                                   | Filters only that media's expected native echoes                                    |
| propagated-echo transaction                                                      | `SpeedArbitration`                 | one `HTMLMediaElement`                                   | Links one ordinary VSC echo to a direct target rewrite and its next counter-event   |
| click/pointer/key and media-side-effect evidence                                 | `IntentClassifier`                 | unresolved document fallback plus resolved media ledgers | Classifies external rate changes; never persists                                    |

The adapter stores conflict records and echo queues in `WeakMap`s. Short-lived echo transactions use an enumerable `Map` so authority changes and teardown can remove target listeners synchronously; the map is bounded to one entry per controlled media and each controller release clears its entry. `VideoController.remove()` must call `SpeedArbitration.release(video)` to clear the timer, record, echo queue, echo transaction, and media gesture ledger.

## Authority generations

A VSC speed action and an adopted native user choice both claim shared authority:

1. update `lastSpeed` and persist it only when `rememberSpeed` is enabled;
2. advance `authorityEpoch` and cancel all prior-epoch fight timers and echo transactions;
3. reset the acting media into local `HOLDING` state;
4. lazily replace every other media's stale local record with fresh `HOLDING` state when it is next observed or receives lifecycle handling.

A same-value VSC action still starts a new generation. This is intentional: pressing a speed control again is an explicit request to retry media that had locally surrendered.

A bulk VSC command must claim one generation, not one generation per loop iteration. `ActionHandler.createAuthorityBatch()` carries that one-command context through keyboard/controller actions, and bridge popup commands use the same context. The current implementation retains historical shared-speed behavior if a relative batch derives distinct target values: the final target is the shared authority. Persistent per-video speed preferences are outside this contract.

## Local phases

| Phase        | Meaning                                                                     | Lifecycle behavior                                              |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `NO_OPINION` | No shared desired speed exists                                              | Silent; never writes a baseline                                 |
| `HOLDING`    | This media enforces shared `lastSpeed`                                      | Reasserts the desired speed                                     |
| `REARMABLE`  | A fully quiet local war exhausted the budget and has one retry left         | Reasserts once, then becomes `HOLDING`                          |
| `SUPPRESSED` | An activity-context war, or an exhausted re-arm, made this media stand down | Silent until a fresh authority generation or user/native choice |

`NO_OPINION` is global authority absence. `REARMABLE` and `SUPPRESSED` are local phases and therefore never clear `lastSpeed`. A temporary native override is an orthogonal local overlay, not a fifth phase: ending it preserves the underlying phase rather than silently re-arming or unsuppressing a player.

## Events and effects

| Event                         | Source                                                                           | Notes                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `USER_SET(v)`                 | VSC controller, keyboard, wheel, popup                                           | Unambiguous user intent; claims a new authority generation                                        |
| `TEMPORARY_OVERRIDE_START(v)` | Recognized site-native temporary hold                                            | Local overlay only; never claims shared authority or persists `v`                                 |
| `TEMPORARY_OVERRIDE_END(v)`   | First normal rate after that local native hold, or its guarded terminal fallback | Clears the overlay and restores current desired speed only when the underlying phase is `HOLDING` |
| `EXT_RATE(v, class)`          | Native `ratechange` after classifier verdict                                     | `class ∈ {USER_INTENT, AUTONOMOUS, INIT_NOISE}`                                                   |
| `LIFECYCLE`                   | `play`, loaded `seeked`, deferred `loadedmetadata`                               | Site reset boundaries                                                                             |
| `FIGHT_WINDOW_EXPIRE`         | Per-media timer                                                                  | Forgives that media's local fights                                                                |
| `RELEASE`                     | Controller teardown                                                              | Clears all local runtime state for that media                                                     |

| Effect       | Meaning                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `WRITE(v)`   | Set only the affected media's `playbackRate`; register its echo token first                        |
| `PERSIST(v)` | Claim shared in-memory authority and schedule a storage write only when `rememberSpeed` is enabled |
| `SYNC_UI(v)` | Update only the affected controller's speed badge                                                  |

Echo queues are per media and tagged with the authority generation that wrote them. `consumeEcho()` discards an older-generation token before matching, so a real site reset that reuses an old rate after a fresh user choice reaches arbitration instead of being swallowed as an echo. Consuming an ordinary echo filters it only from VSC's decision pipeline; the native event still propagates so player controls and auxiliary media can synchronize with the write.

During document capture, VSC starts one media-local transaction for each ordinary echo and appends a listener at the media target. That listener runs after target listeners registered before the dispatch. If they leave the register unchanged, the transaction ends. If they rewrite it, the transaction records the resulting rate and consumes exactly the next non-token `ratechange` for that media; matching media, authority generation, and observed counter-rate are required. A mismatch clears the transaction and follows ordinary classification. No wall-clock window establishes causality.

A nested synthetic `ratechange` while the source echo is still propagating is stopped and deferred until the target listener completes the observation. If propagation is stopped before that listener, VSC has no proof and conservatively clears the transaction on the next event. Page capture listeners that run before VSC and target listeners that stop later target listeners are outside this proof boundary.

### VSC write authority

An explicit VSC speed command owns the immediate `playbackRate` transaction. Its initial native echo remains visible so player controls, auxiliary media, and passive integrations can observe it. If a player synchronously rewrites the same media register in response and VSC can causally associate the rewrite, that value is player policy—not a new user choice—and cannot replace shared authority or be persisted. It enters the bounded autonomous-fight path; only the corrective retry echo is hidden to prevent another veto.

Authority ends with that transaction; VSC does not own the register permanently or fight without limit. Later native choices, asynchronous resets, unrelated media, new authority generations, and subsequent VSC commands use normal classification, propagation, and arbitration.

This deliberately favors VSC's granular rate over players that enforce restricted rates through change-event reactions. Because DOM propagation cannot suppress one listener, the corrective echo is hidden from all downstream page listeners; player UI or internal state may therefore retain the rejected rate. Causal proof excludes earlier document-capture listeners, listeners that block target observation, listeners installed after VSC's observer during the dispatch, and asynchronous rewrites. Since `ratechange` identifies neither writer nor assigned value, a genuine native choice matching the recorded counter-rate before its queued event arrives can receive one correction; re-selection is preferred to allowing a proven veto to replace VSC authority.

The policy is automatic. Add a compatibility mode only for a concrete conflict outside this rule. Reactive-echo isolation is browser-adapter policy, not a pure-arbiter or TLA+ transition.

Site handlers may declare one such compatibility mode, `hidesRateEcho(video, rate)`. Its echoes use the same hidden-token path as the corrective retry. It covers players whose veto is asynchronous and therefore outside causal proof. Twitch is the current case (#1651): its player core forwards every observed rate to a worker, which answers one round trip later with a 2x clamp. Each VSC write above 2x was undone, the fight budget ran out, and VSC stood down at 2x. The player core never re-asserts its rate on its own, so hiding VSC writes above the clamp is enough. Writes at or below it stay visible, so Twitch's menu keeps tracking them. This is adapter-only: it changes no authority, conflict-record or TLA+ transition.

There is intentionally no document-wide surrender effect. Local surrender is not an authority mutation.

## Transition table

The pure [`SpeedArbiter`](../src/core/arbiter.js) is a local state machine. The adapter supplies the current shared desired speed and maps effects onto DOM/storage primitives.

| Local phase                          | Event                                                                                | Effects                                                       | Next local phase                  | Contract                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `NO_OPINION`                         | `LIFECYCLE`                                                                          | none                                                          | `NO_OPINION`                      | No opinion means no write, including no forced `1.0x`                         |
| any                                  | `USER_SET(v)`                                                                        | `WRITE(v)`, `PERSIST(v)`, `SYNC_UI(v)`                        | `HOLDING(v)`                      | Fresh shared authority generation; resets local conflict state                |
| `HOLDING`, `REARMABLE`, `SUPPRESSED` | `TEMPORARY_OVERRIDE_START(2.0)`                                                      | `SYNC_UI(2.0)`                                                | same phase + local overlay        | Recognized YouTube hold; preserve desired, storage, epoch, and fight state    |
| phase + overlay                      | `TEMPORARY_OVERRIDE_END(v)`                                                          | `WRITE(d)`, `SYNC_UI(d)` if `HOLDING`; otherwise `SYNC_UI(v)` | same underlying phase, no overlay | Release restores the current shared target only for a locally enforcing media |
| any + overlay                        | `LIFECYCLE`                                                                          | none                                                          | unchanged                         | Lifecycle healing cannot cancel a visible native hold                         |
| any                                  | `EXT_RATE(v, USER_INTENT)`                                                           | `PERSIST(v)`, `SYNC_UI(v)`                                    | `HOLDING(v)`                      | Adopt a durable native user choice as fresh shared authority                  |
| `HOLDING(d)`                         | `LIFECYCLE`                                                                          | `WRITE(d)` when needed                                        | `HOLDING(d)`                      | Reassert without persistence                                                  |
| `HOLDING(d)`                         | `EXT_RATE(d, AUTONOMOUS)`                                                            | `SYNC_UI(d)`                                                  | `HOLDING(d)`                      | Site confirmed the desired rate; refresh the affected badge                   |
| `HOLDING(d)`                         | `EXT_RATE(v ≠ d, AUTONOMOUS)`, local count below budget                              | `WRITE(d)`                                                    | `HOLDING(d)`                      | Fight only this media and increment only its count                            |
| `HOLDING(d)`                         | autonomous divergence at budget, whole local war input-quiet, local re-arm available | `SYNC_UI(v)`                                                  | `REARMABLE(d)`                    | Stand down locally and spend one local re-arm                                 |
| `HOLDING(d)`                         | autonomous divergence at budget after input activity or spent re-arm                 | `SYNC_UI(v)`                                                  | `SUPPRESSED(d)`                   | Stand down locally; retain shared authority for other media                   |
| `REARMABLE(d)`                       | `LIFECYCLE`                                                                          | `WRITE(d)`                                                    | `HOLDING(d)`                      | One local retry only                                                          |
| `SUPPRESSED(d)`                      | `LIFECYCLE` or autonomous rate                                                       | none / `SYNC_UI(v)`                                           | `SUPPRESSED(d)`                   | Do not restart a local write war automatically                                |
| any                                  | `EXT_RATE(_, INIT_NOISE)`                                                            | none                                                          | unchanged                         | Ignore initialization/min-rate noise; a later lifecycle event may heal it     |
| any                                  | `FIGHT_WINDOW_EXPIRE`                                                                | none                                                          | same phase with local count zero  | Forgive isolated local resets                                                 |

The timer is cleared when a local war reaches `REARMABLE` or `SUPPRESSED`; otherwise an old timer could retain the media record and mutate a settled decision later.

## Core invariants

1. **No-opinion safety:** no lifecycle path writes when shared authority is absent.
2. **Persistence purity:** only `USER_SET` and accepted durable native `USER_INTENT` update `lastSpeed`/storage; lifecycle, fight-back, surrender, re-arm, and temporary native holds do not.
3. **Per-media non-interference and bounded fighting:** one autonomous event causes at most one write and can mutate only its own conflict record; each media spends only its own `MAX_FIGHT` budget.
4. **Local surrender:** a `REARMABLE` or `SUPPRESSED` record preserves shared authority and leaves every other record usable.
5. **Fresh-choice recovery:** one VSC/native choice invalidates stale local suppression and lets the next lifecycle event retry that media.
6. **Teardown safety:** no timer, echo transaction, deferred metadata callback, or classifier evidence may survive a controller's removal.
7. **Temporary-override locality:** a temporary native hold can mutate only its media register and overlay; it cannot change `lastSpeed`, storage, the authority epoch, fight state, or another media's UI/register.
8. **Gesture isolation:** confidently attributed A evidence must never bless B. Unresolved evidence may use the documented fallback, but it is never combined into a synthetic A/B sequence.

## Gesture attribution and classifier boundary

`IntentClassifier` receives a `media` context for a ratechange. It stores resolved click sequences in a `WeakMap` keyed by media and retains a separate document-level fallback ledger only for unresolved gestures.

`EventManager.resolveGestureMedia(event)` first examines `event.composedPath()` for exactly one controlled media element. It does not use `target === video` or `video.contains(target)`: custom-player controls, menus, overlays, and native controls routinely live outside the media subtree.

If the path is unresolved, `SiteHandlerManager.resolveGestureMedia()` may delegate to the current site handler. A handler must return a controlled media element only when ownership is unambiguous; otherwise it returns `null`. The YouTube resolver recognizes its player chrome and embedded sibling controls while rejecting ambiguous or unrelated global controls.

Known A click evidence and unresolved fallback click evidence are intentionally separate ledgers. Combining them could manufacture a strong two-click sequence that never occurred on either scope.

Pointer holds remain conservative. The documented `www.youtube.com` press-and-hold 2x boost is a temporary override, not durable `USER_INTENT`: while held it updates only that media's badge; on release it restores the current shared target only if that media remains `HOLDING`. YouTube restores its own app-level rate on release (`1.0` unless changed through its menu), so treating that write as durable intent would structurally reset users; the release instead completes the overlay and re-asserts the current shared target.

Hold-evidence lifecycle is deliberately narrow. `pointerup` and `pointercancel` are the only pointer terminals; only the final active pointer/Space source for a media can schedule release, so one terminal cannot cancel another active hold, and the overlay then waits for the normal release `ratechange` with a short per-media fallback if none arrives. `lostpointercapture` is ignored entirely: capture events are synthesized bookkeeping whose `buttons` value differs across browser builds, and real terminals always reach the document-capture listeners. Window focus-safety handlers are bound in the bubble phase because non-bubbling element `blur` events still capture through `window`; a press that merely refocuses page UI must not wipe the very evidence it just armed, while a genuine window blur, page hide, hidden-document transition, or Space `keyup` still retires holds through the guarded fallback. An unresolved press may claim a 2x change only while causally plausible (5s); the newest press binds, so a stale pointer whose terminal was lost outside the window can neither bless later rate changes nor disable recognition.

Strong native speed-key or menu evidence outranks the hold signature before a physical terminal, so an explicit durable native choice can supersede it; once a terminal is pending, its release rate wins even if the release click completes an otherwise strong click sequence. The release click of a completed long press (≥400ms) is never click-intent evidence: repeated hold attempts would otherwise manufacture a strong click sequence that adopts and persists the structural `1.0` release write. Weak click evidence remains below the hold signature to prevent a release reset from persisting `1.0x`. Adopting a durable choice clears temporary evidence only for that same resolved media, never an active hold on another media.

Attribution does not prove a same-player click selected a speed. The classifier still treats a single click to exactly `1.0x` as autonomous, while a click sequence, recognized speed key, or documented site signature supplies stronger evidence.

A click sequence is still ambiguous for exactly `1.0x`: player controls can produce the same two-click shape as opening a speed menu and choosing “Normal.” Sequence-only `1.0x` changes are therefore demoted to `AUTONOMOUS` when the same media is actively seeking, emitted `seeking` or `seeked` within one second, or attached/crossed a `loadstart` resource boundary within two seconds. Live `media.seeking` is required because Chromium can deliver `ratechange` before the queued `seeking` event; the timestamps cover resets during and shortly after the seek. Ordinary MSE representation switches are not claimed to emit `loadstart`.

Recognized native speed keys remain sufficient `USER_INTENT` even during those windows, and a two-click native “Normal” choice remains durable outside them. The negative evidence is media-keyed, never combines across players, and is deleted on controller release. This deliberately favors a recoverable false negative—one fight or re-click—over falsely persisting `1.0x` into shared session state and storage.

Per-site signature activation is declared by site handlers (`BaseSiteHandler.getClassifierRules()`), never by hostname tables in core: the classifier owns what each rule flag means, the handler declares which flags its `matches()` hosts activate, and every activation must cite its motivating issue. Adding a site signature therefore touches one handler file, alongside that site's positioning and gesture-resolution logic.

## Formal model and TLC

[`specs/SpeedArbiter.tla`](../specs/SpeedArbiter.tla) models two videos (`A`, `B`), two symbolic speeds, a one-fight local budget, independent session authority and persisted storage, both `rememberSpeed` settings, local phase/budget/pending state, temporary native overrides, native adoption, local surrender/re-arm, lifecycle locality, and release. This includes the site-rule shape where in-memory authority differs from stored speed. The wrapper fixes TLC's fingerprint polynomial, so the bounded model's reported state count is reproducible for a given TLC version and configuration.

The TLA+ model is intentionally an abstraction, not an executable browser simulator. It eagerly resets conflict records on an authority claim instead of retaining stale epoch-tagged `WeakMap` entries; this is observationally equivalent to lazy reset. Temporary overrides are deliberately separate from those conflict records, so an authority choice on B cannot erase A's active native hold before release restores the latest shared target. The model represents the known 2x boost and its release directly, while JS tests cover gesture attribution, capture-loss inertness, terminal-release fallback, long-press click suppression, Space key lifecycle, strong native-intent precedence, media-side-effect demotion, epoch-tagged echo-token queues, reactive echo isolation, browser event coalescing, and deferred metadata DOM listener wiring. Reactive echo isolation is an adapter-level propagation policy around the existing `WRITE` effect, so it does not change the modeled state machine. Init-noise convergence is likewise outside the model's safety assertions because the production adapter deliberately waits for lifecycle handling.

Run TLC with the reproducible wrapper:

```sh
npm run test:tlc
```

The wrapper requires Java 11 or newer, obtains only official TLA+ release `tla2tools.jar` version `1.7.4`, verifies SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`, and caches it outside the repository at `~/.cache/videospeed/tlc`. Set `TLC_JAR=/path/to/tla2tools.jar` to use a local copy only when it has the same pinned checksum. Successful runs remove their TLC metadata; a failed run retains its metadata under `~/.cache/videospeed/tlc/runs/` and prints the exact path for diagnosis.

CI installs Temurin Java 17, caches the verified JAR, and runs `npm run test:tlc` explicitly after the JavaScript suite. `npm test` does not invoke TLC.

## Verification map

| Layer                    | What it checks                                                                                                                         | Command                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure core tests          | Local phase/effect transitions and bounded mini-model invariants                                                                       | `npx vitest run tests/unit/core/arbiter.test.js`                                                                                                              |
| Differential replay      | Production pipeline versus pure local arbiter for single-media traces, including side-effect reset persistence                         | `npx vitest run tests/integration/arbiter-differential.test.js`                                                                                               |
| Multi-video integration  | Independent budgets, local surrender/re-arm, temporary-override locality, authority epoch, bulk batching, release                      | `npx vitest run tests/integration/multi-video-arbitration.test.js`                                                                                            |
| Gesture/refinement tests | Scoped click ledgers, side-effect demotion, temporary hold/release, terminal fallback, focus safety, and resolver behavior             | `npx vitest run tests/unit/core/intent-classifier.test.js tests/unit/utils/event-manager.test.js tests/unit/site-handlers/youtube-gesture-resolution.test.js` |
| Timing geometry          | Constant orderings against measured anchors (YouTube 500ms engagement, click-press durations)                                          | `npx vitest run tests/unit/core/timing-constants.test.js`                                                                                                     |
| TLA+ model               | Shared authority plus two local conflict registers, temporary-override locality, and autonomous non-interference                       | `npm run test:tlc`                                                                                                                                            |
| Browser arbitration E2E  | Real media event ordering, reactive echo isolation, trusted click sequences, persistence, local surrender/re-arm, and deferred removal | `npm run build && node tests/e2e/run-e2e.js arbitration`                                                                                                      |
| Full repository check    | Lint, unit/integration tests, and release build                                                                                        | `npm run lint && npm test && npm run build:release`                                                                                                           |

## Change checklist

1. State whether the change belongs to shared authority, a per-media conflict record, the classifier, or a site resolver.
2. Keep MAIN-world code free of `chrome.*` and keep bridge code free of page DOM access.
3. Add or update a pure transition test when arbiter semantics change; keep adapter-only DOM behavior out of the pure core.
4. Add a multi-video regression whenever a change can affect ownership, local timers, local suppression, or bulk actions.
5. Update the TLA+ model only for pure shared/local arbitration semantics; test DOM attribution separately.
6. Run lint, the affected Vitest suites, `npm run test:tlc`, and the full verification set before merging.
