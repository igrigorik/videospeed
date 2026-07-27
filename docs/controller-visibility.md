# Controller visibility contract

Controller visibility is a layered state machine. It is not one boolean and must not be implemented as one sticky CSS class. The user override, automatic media state, site-owned autohide, transient feedback, unusable media, external host CSS, and controller lifecycle are independent inputs with explicit precedence.

The production policy is `src/core/controller-visibility.js`. Its machine-checked model is `specs/ControllerVisibility.tla`. DOM and CSS conformance is checked in `tests/integration/controller-visibility-differential.test.js` and `tests/e2e/display-toggle.e2e.js`.

## Scope

The contract covers:

- one explicit override per controller: `AUTO`, `SHOW`, or `HIDE`;
- automatic visibility from `startHidden`, media visibility, and audio-controller enablement;
- site-owned autohide such as YouTube's `.ytp-autohide`;
- temporary video feedback and persistent audio feedback;
- no-source and external host hiding;
- targeted and document-wide display actions;
- timer expiry and controller teardown.

Persistence across reloads, cross-frame synchronization, and ownership shared with page scripts are not part of this contract. Adding any of them changes the concurrency model and requires revisiting both the TLA+ state space and the DOM adapter.

## State

| Concept            | Pure model        | TLA+                 | DOM/adapter                                                               |
| ------------------ | ----------------- | -------------------- | ------------------------------------------------------------------------- |
| Lifecycle          | `attached`        | `attached[i]`        | `video.vsc`, connected `<vsc-controller>`, `StateManager` membership      |
| User intent        | `override`        | `overrideMode[i]`    | absent `data-vsc-visibility`, or `show` / `hide`                          |
| Automatic layer    | `automaticHidden` | `automaticHidden[i]` | `vsc-hidden`                                                              |
| Unusable media     | `noSource`        | `noSource[i]`        | `vsc-nosource`                                                            |
| Site autohide      | `siteAutohide`    | `siteAutohide[i]`    | domain-scoped host CSS observing page-owned state such as `.ytp-autohide` |
| External host hide | `hostHidden`      | `hostHidden[i]`      | computed `display` / `visibility` on `<vsc-controller>`                   |
| Feedback           | `flash`           | `flashMode[i]`       | `vsc-show` plus an optional `flashTimer`                                  |
| Preference         | `startHidden`     | `startHidden`        | live settings value consulted by future automatic-show and flash events   |
| Media kind         | `mediaType`       | `AudioControllers`   | media tag name                                                            |

`startHidden` initializes the automatic layer but is not itself a permanent hard-hide bit. A live change to `startHidden` is non-retroactive: it does not immediately rewrite an existing controller or cancel an active flash. It blocks future automatic-show and flash requests until disabled.

## Render precedence

For a controller `i`:

```text
hardHidden = !attached || hostHidden || noSource || override == HIDE
forcedShown = override == SHOW || flash != NONE
visible = !hardHidden && (forcedShown || (!automaticHidden && !siteAutohide))
```

Equivalent precedence, highest first:

```text
external host hide / no source / FORCE_HIDE
  > FORCE_SHOW / flash
  > automatic hide / site autohide
```

`SHOW` deliberately overrides `vsc-hidden` and site autohide, but it cannot resurrect a detached controller, make unusable media useful, or defeat unrelated page CSS that hides the light-DOM host. `HIDE` defeats a stale flash class. Opacity is excluded from the discrete visibility predicate because fades pass through zero; computed `display` and `visibility` on both host and shadow controller define the sampled state.

YouTube site autohide is implemented by domain-scoped light-DOM CSS on `<vsc-controller>`, not by copying page state into extension-owned DOM and not by the deprecated `:host-context()` selector. The host rule excludes explicit `SHOW` and `vsc-show` feedback before applying `visibility: hidden`; shadow selectors keep automatic hide, explicit `HIDE`, and no-source precedence. Changing either side requires the Chrome matrix test, not just a unit test.

## User toggle transition

A display action samples rendered visibility before cancelling feedback:

| Current override | Pre-action rendered state | Next override | Flash after action |
| ---------------- | ------------------------- | ------------- | ------------------ |
| `AUTO`           | visible                   | `HIDE`        | none               |
| `AUTO`           | hidden                    | `SHOW`        | none               |
| `SHOW`           | either                    | `AUTO`        | none               |
| `HIDE`           | either                    | `AUTO`        | none               |

This is intentionally not a fixed `AUTO → SHOW → HIDE → AUTO` cycle. The first press opposes what the user can currently see; the second press returns control to the automatic layer. Sampling before clearing `vsc-show` is essential: `AUTO + site autohide + flash` is visibly shown, so the first press must select `HIDE`, not `SHOW`.

Keyboard and popup display actions broadcast to every attached controller. Each controller samples and transitions independently, so one broadcast may produce `HIDE` on a visible controller and `SHOW` on a hidden controller. A targeted adapter action affects only its owner. Released controllers are absent from broadcasts and cannot be mutated by an expired timer.

## Automatic, feedback, and lifecycle transitions

- Automatic hide sets `automaticHidden` without changing override or feedback.
- Automatic show clears `automaticHidden` only when `startHidden` is false.
- Source, site-autohide, and external-host changes affect only their own rendering layer.
- A permitted video feedback request enters `TIMED_ARMED`; timer progress enters `TIMED_DUE`; expiry returns to `NONE`. A repeated request re-arms the timer.
- A permitted audio feedback request enters `PERSISTENT`. It has no timer and lasts until a display toggle or release.
- `startHidden` and explicit `HIDE` block new feedback requests. Existing feedback survives a later live `startHidden=true` setting change and still expires normally.
- Release clears override and feedback atomically for the abstract controller, cancels the production timer, removes StateManager membership, detaches `video.vsc`, and removes the host. Release is terminal for that controller identity; later control of the same media is a fresh controller initialized from current inputs.

## Formal model

`specs/ControllerVisibility.tla` uses two controllers, one video and one audio. It explores local toggles, broadcast toggles, automatic and environmental changes, live `startHidden` changes, flash requests, bounded timer progress, expiry, and release. `StopTimerRefresh` is an auxiliary environment action: safety remains checked whether it occurs or not, while its false state marks a suffix in which no more video flash requests re-arm the timer.

TLC checks:

- type and media-specific flash invariants;
- explicit `HIDE` / flash exclusion;
- detached-controller inertness;
- targeted-action locality and broadcast independence;
- environment and settings non-interference with user intent;
- intent changes only through toggle or release;
- weak-fair eventual progress for armed and due video timer phases;
- eventual video flash clearance or release after the environment stops re-arming the timer.

Hard-hide, force-show, flash, and automatic-layer precedence are consistency lemmas over the derived `Visible` predicate. They make the render definition reviewable but are not independent transition-safety proofs: substituting the definition makes them tautologies. The Chrome matrix is the independent check that the real stylesheet refines that predicate.

The bounded timer models ordering and eventual progress, not wall-clock milliseconds. CSS selectors, computed style, DOM connection, JavaScript timer ownership, and event dispatch are adapter concerns and are intentionally verified outside TLA+.

## Executable refinements

The verification layers answer different questions:

1. `npm run test:tlc` exhaustively checks the two-controller temporal model. The current configuration reaches 49,152 distinct states, generates 724,800 states, and checks three non-vacuous video-timer liveness branches.
2. `tests/unit/core/controller-visibility.test.js` enumerates 448 valid local states and 6,720 state/event pairs against the pure JavaScript transition policy.
3. `tests/integration/controller-visibility-differential.test.js` replays deterministic mixed traces through the pure model and real `ActionHandler` / `VideoController` adapters, including local and broadcast actions, video and audio feedback, environment changes, live settings, expiry, and release.
4. `tests/e2e/display-toggle.e2e.js` checks the real document-and-shadow cascade across `3 overrides × 2 automaticHidden × 2 siteAutohide × 2 flash × 2 noSource × 2 hostHidden = 96` render combinations, then verifies mixed two-controller local, broadcast, flash-sampling, and release behavior in Chrome.

A green TLA+ run cannot prove that CSS source order is correct, and a green browser matrix cannot prove timer liveness or non-interference across all action sequences. Both are required for changes to this contract.

## Change checklist

A visibility change must:

1. State which transition or precedence rule changes.
2. Update `src/core/controller-visibility.js` and its bounded JavaScript tests.
3. Update `specs/ControllerVisibility.tla` when the abstract state, action alphabet, safety invariant, or liveness expectation changes.
4. Update the differential adapter test when DOM classes, attributes, timer ownership, dispatch scope, or lifecycle mapping changes.
5. Update the Chrome matrix when selectors, host rendering, or cascade precedence changes.
6. Run `npm test`, `npm run test:tlc`, `npm run build`, and `node tests/e2e/run-e2e.js display`.

Do not mutate page-owned `<html>` or `<body>` to persist VSC state. `data-vsc-visibility` belongs only on the extension-owned `<vsc-controller>` host. Site-owned ancestor state may be observed through computed CSS, but core visibility logic must not duplicate a site's autohide state machine.
