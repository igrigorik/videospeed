# Release 0.11.0 — notes and tracker audit

Status: DRAFT (branch `spec/speed-arbitration`, pre-merge). The release
notes below are the proposed GitHub-release / Web Store text; the tracker
audit records the disposition of every issue and PR open as of 2026-07-22,
classified against the work landed on this branch. Action lists here are
the plan of record for the post-release sweep.

---

## Release notes (draft)

**Speed arbitration rebuilt: native controls respected, bounded fighting,
per-tab speeds**

This release rebuilds how VSC decides what the playback speed should be.
The old logic was a set of scattered heuristics that fought the site — and
sometimes you — in unpredictable ways. Speed decisions now flow through a
single, formally specified arbitration engine.

### Fixes you'll notice

- **YouTube's hold-for-2x works again** — both click-and-hold and holding
  spacebar (#1554, #1568)
- **Arrow-key seeking no longer resets your speed** on YouTube and
  elsewhere (#1562, #1546)
- **Clicking the progress bar no longer resets speed to 1x** on Facebook
  and similar players (#1581)
- **Speeds set through a site's native menu now stick** — VSC adopts them
  instead of reverting them on the next pause/seek (#1521)
- **VSC no longer overrides the native speed control at page load** when
  it has no speed of its own to assert (#1537)
- **Per-tab speeds** (#1559): changing speed in one tab no longer changes
  it in your other open tabs. New tabs pick up whatever speed you set
  last.
- **Per-site speed rules behave like a real default**: you can override
  them with any control, and your override sticks until reload

### Behavior changes worth knowing

- **Fighting is now bounded.** If a site programmatically resets the
  rate, VSC re-applies your speed up to 4 times in quick succession, then
  stands down for the session (one keypress re-engages). Previously this
  could loop forever — the likely cause of periodic CPU spikes on
  live-stream sites (#1587) and sluggish page UI (#1556). If the reset
  war happened entirely while you weren't interacting, VSC restores your
  speed once on the next play.
- **Isolated resets are forgiven** — a single site-initiated reset more
  than 3 seconds after the last one never accumulates toward standing
  down.
- **Speed is only saved to storage when _you_ change it** — automatic
  restores and site events never overwrite your remembered speed.

### Under the hood

Speed decisions are now split into an evidence-based intent classifier
(was that rate change you, or the site?) and a pure arbitration state
machine with a machine-checked TLA+ specification. The production
pipeline is pinned to the verified model by a differential test harness,
and every historical speed bug has a permanent regression test. The 200ms
"cooldown" blackout window is gone, replaced by precise write-token echo
filtering — VSC no longer goes blind after its own writes. Contributors:
speed-behavior PRs should cite the transition table in
`docs/speed-arbitration.md` (see CONTRIBUTING).

**Credits**: thanks to @rdavidwu (#1537), @sharno (#1563), and @Tredecate
(#1555) — your diagnoses and PRs are incorporated into the new classifier
rules, with provenance comments in the code — and to everyone who filed
the detailed reports this rework is built on.

---

## Tracker audit (2026-07-22: 38 open issues, 27 open PRs)

### Cluster A — fixed by this branch → close on release

Comment "fixed in 0.11.0" with the relevant mechanism, then close.

| #     | Title                                     | Fixed by                                             |
| ----- | ----------------------------------------- | ---------------------------------------------------- |
| #1554 | YT click+hold 2x broken                   | YouTube site signature (pointer-hold + spacebar arm) |
| #1568 | Hold-for-2x breaks after controller use   | same fix; effectively duplicate of #1554             |
| #1562 | YT speed resets on arrow-key seek         | TARGET_RULES (only speed keys arm intent)            |
| #1546 | Arrow-key seek resets speed (generic)     | same class as #1562                                  |
| #1581 | Facebook: slider click resets to 1x       | tiered evidence + value asymmetry (generic fix)      |
| #1521 | Native-control speed lost on unpause/seek | adoption (cells 2/7) + lifecycle re-assert           |
| #1559 | Cross-tab speed bleed                     | session isolation                                    |

### Cluster B — community PRs subsumed by the rework → credit + close

- **PR #1537** (rdavidwu) — cell-1 fix; shipped generalized (no opinion ⇒
  no writes). Close crediting the diagnosis.
- **PR #1563** (sharno) — arrow-seek fix; subsumed into TARGET_RULES,
  provenance cited in classifier comments. Credit + close.
- **PR #1555** (Tredecate) — click+hold fix; subsumed into the YouTube
  site signature, provenance cited. Credit + close.
- **PR #1532** (ColtonIdle) — YT seek-reset DOM heuristic; superseded
  (fixed generically; DOM narrowing rejected as fragile — documented in
  the contract). Close with explanation.

### Cluster C — plausibly fixed, unconfirmed → ask to retest on 0.11.0

Close after confirmation; investigate only if a report survives retest.

- **#1587** Twitch CPU spikes every 20–25s — matches the unbounded
  write-war signature; bounded fighting + echo filter should eliminate
  it (the periodicity fits surrender→quiet→refight loops that no longer
  exist).
- **#1556** YouTube UI slowdown — same suspected engine.
- **#1573** bilibili reset on pause/resume — lifecycle re-assert +
  bounded fighting class.
- **#1551** YouTube/cineby resets — same class.
- **#1560** "speed changes without my input" — vague, but every misfire
  class it could belong to was reworked.
- **#1578** YT doesn't autoplay after speed-up shortcut — unclear cause,
  but the event pipeline it passes through was rebuilt (no synthetic
  events, no cooldown propagation-stopping).

### Cluster D — answerable now, no code needed

- **#1590** "Option to use old behavior?" — field evidence validating
  this branch's decisions. Point 1 (tab-isolated speeds) is exactly what
  session isolation ships → "fixed in 0.11.0". Point 2 (wants VSC to
  _override_ YT's hold-2x) is the documented augment-don't-override
  policy — explain; the pre-boost speed is restored on release. Close
  after reply.
- **#1528** "bring back excluded sites" — exists as site rules (migrated
  from the old blacklist). Reply with instructions, close.
- **#1564** Instagram disabled by default — product decision; either flip
  the default (one-line change) or close as working-as-intended with a
  settings pointer.
- **#1502** controller not visible — `blocked:feedback` since April, no
  repro. Close as stale.

### Cluster E — real, open, not arbitration: UI/positioning

Suggested next workstream after the release sweep.

- **#1570** controller offset doubled inside positioned containers —
  root-caused by the reporter with a public repro URL; the most
  actionable bug in the tracker.
- **#1522** overlaps YouTube Shorts controls
- **#1558** centered on Udemy
- **#1584** hides when player UI fades (autohide coupling)
- **#1529** grab-bag: visibility, YT autohide, fullscreen scroll
- **#1519** wants a close button back (product decision)

### Cluster F — open: site support / needs info

- **#1572** xHamster stopped working
- **#1520** old.reddit stopped working
- **#1544** Brave thumbnails
- **#1561** Brave shortcuts (needs info)
- **#1533** F1 TV won't speed up — site actively enforces; under the new
  rules VSC fights 4× then stands down. Likely "site wins" wontfix
  unless a site handler is warranted.

### Cluster G — open: feature requests (label and leave)

- **#1553 + #1588** fullscreen shortcut/button (mark #1588 duplicate)
- **#1545** frame-step
- **#1580** Media Session API (well-written; composes with the WRITE
  primitive)
- **#1552** sync injected AudioContext streams — partially impossible
  (Web Audio has no playbackRate); the `<audio>`-tag half exists via the
  audio setting
- **#1566** disable Shorts looping (scope question)
- **#1539** disable pinch/wheel speed change
- **#1583** per-site permissions
- **#1547** Firefox port

### Cluster H — open bug: settings

- **#1527** can't disable on localhost — likely a site-rule
  pattern-matching gap for bare hostnames; small, worth a look next.

### PRs — review queue

- **#1585** settings-bridge reinit + about:blank (YUMA-NAGAO) — review
  next; bridge subsystem, substantive.
- **#1586** local-file diagnostics + E2E (draft, same author) — after
  #1585.
- **#1571** live-stream catch-up after pause — touches speed behavior:
  first PR that must cite contract cells under the new CONTRIBUTING
  rule; review with the transition table open.
- **#1500** Crunchyroll/Bitmovin support — site-handler extension point,
  review independently.
- **#1518** 1x reset button / **#1517** speed slider / **#1483** volume
  boost — product decisions, not urgent.
- **16 dependabot PRs** — batch the patch/minor bumps after release; the
  majors (archiver 8, lint-staged 17, puppeteer 25) need a CI look
  first.

### Suggested sequence

1. Release 0.11.0.
2. Post the Cluster A/B closes and Cluster C retest asks in one sweep.
3. Answer Cluster D.
4. Next code workstreams: #1570 (root-caused positioning bug) and the
   #1585 review.
