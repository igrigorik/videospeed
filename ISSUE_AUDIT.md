# Open Issue Audit & Root Cause Analysis

_Audit date: 2026-03-19 | 40 open issues analyzed_

## Issue Clusters

### Cluster 1: Settings Race Condition & Data Loss (9 issues)

| Issue | Title |
|-------|-------|
| #1413 | Settings overwritten from page with stale settings |
| #1414 | Fix setting overwrite race condition (PR) |
| #1424 | Settings not saving |
| #1423 | "Hide controller by default" not functioning |
| #1400 | Changing Speed Reset Setting from 0.5 doesn't work |
| #1398 | Key 255 automatically set when creating custom button |
| #1397 | Fix getTargetSpeed initialization when rememberSpeed is off (PR) |
| #1396 | Speed being set to 0.9 automatically |
| #1405 | Default speed unexpectedly 1.4x |

### Cluster 2: Controller Positioning & Overlap (8 issues)

| Issue | Title |
|-------|-------|
| #716  | Initial Position Setting? |
| #1143 | Default position of controller on screen |
| #1202 | Controller hidden by YouTube UI |
| #1285 | Option to place controls at different corners (PR) |
| #1312 | Add controller positioning options (PR) |
| #1399 | Adjustable controller position suggestion |
| #1401 | Remember controller position in % of container |
| #1427 | Controller shows on YouTube video and also logo |

### Cluster 3: Sites Override Speed / Extension Fights Back (7 issues)

| Issue | Title |
|-------|-------|
| #1429 | Not working on Netflix on M4 Mac |
| #1305 | Overlay changes but actual playback stuck (Kollus) |
| #1418 | Speed changes randomly on Brave |
| #1406 | Extension causes problems on Strava |
| #1404 | Dailymotion videos don't open |
| #1408 | YouTube max speed before failing lowered from 6 to 4 |
| #1420 | YouTube playback / autoplay issues |

### Cluster 4: Feature Requests (6 issues)

| Issue | Title |
|-------|-------|
| #1402 | Site-specific default playback speeds |
| #1426 | Pause feature shortcut key |
| #1201 | Full screen shortcut |
| #1419 | Chord shortcuts (Shift+P, Ctrl+D) (PR) |
| #1412 | Snap-to-1.0x feature (PR) |
| #1242 | Add reset button to quick shortcuts (PR) |

### Cluster 5: Other / Misc (10 issues)

| Issue | Title |
|-------|-------|
| #1428 | Buffering/stutter on F1 TV |
| #1185 | Fix YouTube subtitles lagging behind (PR) |
| #1407 | Hide control panel on Telegram stickers |
| #1403 | Speed display not showing |
| #1409 | Resume from last position broken |
| #1410 | Update extension badge to show speed (PR) |
| #1415 | Speed presets up to 6.0x (PR) |
| #1223 | Git tags out of sync with Chrome extension versions |
| #1425 | Bump minimatch (dependency PR) |
| #1422 | Bump basic-ftp (dependency PR) |
| #1421 | Disregard (empty) |

---

## Root Cause Analysis: 4 Meta-Issues

### META-ISSUE 1 (P0): Settings Race Condition — No Concurrency Control on Shared Storage

**Symptoms**: Settings silently revert, speeds change unexpectedly, custom shortcuts get key 255, "hide by default" doesn't stick.

**Root cause**: `settings.js:save()` performs a read-modify-write of the **entire** settings object every time anything changes. The options page and every content script tab each hold their own in-memory copy. When any of them saves, it overwrites whatever the others wrote.

**Key code paths**:
- `settings.js:86` — Even the debounced speed save writes the entire stale settings object: `await StorageManager.set({ ...this.settings, lastSpeed: speedToSave })`
- `options.js:312-325` — Options page does full-object write with `save(settingsToSave)` that doesn't include `lastSpeed`, so the in-memory `lastSpeed` (loaded at page open time) gets written back

**Race scenario**:
```
Tab A:         reads settings (lastSpeed=1.0, startHidden=true)
Options page:  user toggles startHidden=false, saves ALL fields (stale lastSpeed=1.0)
Tab A:         user changes speed to 2.0, saves ALL fields (stale startHidden=true) ← REVERTED
```

**Fix direction**: Use granular `chrome.storage.sync.set()` that writes only changed keys. Implement `chrome.storage.onChanged` listener to refresh stale in-memory state before writing.

**Issues**: #1413, #1414, #1424, #1423, #1400, #1396, #1397, #1405, #1398

---

### META-ISSUE 2 (P2): No Per-Site State Model — Global Singleton Settings

**Symptoms**: Speed set on one site affects all sites, no per-domain defaults, all-or-nothing blacklist.

**Root cause**: A single global `lastSpeed` in `video-controller.js:78`: `const targetSpeed = this.config.settings.lastSpeed || 1.0`. No concept of per-domain configuration exists.

**What this prevents**:
- Different default speeds per site (lectures at 2x, music at 1x)
- Per-site force/enforcement policy
- Per-site controller visibility preferences
- Granular blacklisting (disable speed control but keep controller, or vice versa)

**Fix direction**: Key settings by domain: `siteSettings[hostname] = { lastSpeed, startHidden, position, ... }`. Fall back to global defaults for unconfigured sites.

**Issues**: #1402, #1429, #1305, #1396, #1405

---

### META-ISSUE 3 (P1): Adversarial Speed Enforcement is Timing-Based and Fragile

**Symptoms**: Speed won't stick on Netflix/Kollus, random speed changes, sites break entirely (Dailymotion, Strava), stuttering at high speeds.

**Root cause**: The extension's speed enforcement relies on three fragile mechanisms:

1. **Cooldown suppression** (`event-manager.js:169-186`): 200ms cooldown blocks external `ratechange` events. Sites that reset after 200ms bypass this.
2. **Force mode loops** (`event-manager.js:204-215`): `forceLastSavedSpeed` sets `playbackRate` back on every external change. Sites that also force their speed create infinite loops → stuttering/freezing.
3. **Over-aggressive re-application** (`video-controller.js:199-203`): Every `play` and `seeked` event re-applies speed, which fires `ratechange`, which sites intercept and fight.

No site-specific awareness — same generic strategy for cooperative YouTube and adversarial Netflix DRM player.

**Fix direction**: Replace timing-based enforcement with `Object.defineProperty` override on `playbackRate` for adversarial sites. Expand site handler system to include speed enforcement strategies (not just seeking/positioning).

**Issues**: #1429, #1305, #1418, #1406, #1404, #1408, #1420, #1428

---

### META-ISSUE 4 (P1): Hard-Coded Controller Positioning with No User Configuration

**Symptoms**: Controller hidden behind site UIs, overlaps player controls, always stuck in top-left.

**Root cause**: Position hard-coded in `video-controller.js:126-131` with site-specific CSS offsets in `inject.css`. No setting exists for default position. Drag position is ephemeral (stored in inline style, lost on navigation).

**Fix direction**:
- Add `controllerPosition` setting: `"top-left" | "top-right" | "bottom-left" | "bottom-right"`
- Optionally persist drag position as percentage of container size
- Multiple PRs (#1285, #1312) already attempt this

**Issues**: #716, #1143, #1202, #1285, #1312, #1399, #1401, #1427, #1407

---

## Priority Matrix

| Priority | Meta-Issue | Impact | # Issues | Effort |
|----------|-----------|--------|----------|--------|
| **P0** | Settings race condition | Data loss, silent corruption | 9 | Low-Medium |
| **P1** | Controller positioning | Unusable on many sites | 8 | Medium |
| **P1** | Speed enforcement | Broken on adversarial sites | 8 | High |
| **P2** | Per-site settings | Missing core feature | 5+ | High |

The settings race condition is the highest priority: it silently corrupts user data and has the most straightforward fix (granular storage writes + onChange listeners). The positioning and speed enforcement issues require more architectural work but affect users across diverse sites.

---

## P0 Deep Dive: Settings Race Condition — Full Trace

### How The Bug Was Born (Commit Archaeology)

**Commit 1: `39f4307` (2025-07-23) — "update dependencies" (initial commit)**

The original `save()` method established the pattern that would become the bug:

```js
async save(newSettings = {}) {
  this.settings = { ...this.settings, ...newSettings };
  await window.VSC.StorageManager.set(this.settings);  // ← writes ENTIRE blob
}
```

This was "fine" initially because only one context (the content script) ever called
`save()`. The options page had its own direct `chrome.storage.sync.set()` calls.

**Commit 2: `f573d2b` (2025-07-24) — "fix: keyboard shortcuts not persisting after refresh"**

This commit message says _"Unifies storage system to prevent settings from resetting to
defaults. Fixes dual storage conflict between options.js and VideoSpeedConfig."_

Ironically, it **introduced** the race condition by making the options page use the same
`VideoSpeedConfig.save()` method. Now two independent contexts (options page + content
script) both call `save()`, and both do full-blob writes from their own stale in-memory
copy. The "dual storage conflict" was replaced with a "stale-read full-write conflict."

The options page was changed to:
```js
await window.VSC.videoSpeedConfig.save(settingsToSave);
```

Where `settingsToSave` is constructed from DOM form values and does NOT include
`lastSpeed`. But `save()` merges into `this.settings` (which has a stale `lastSpeed`
from page load time) and writes the whole thing.

**Commit 3: `10b76e5` (2025-08-21) — "debounce speed save operations"**

Added debouncing for `lastSpeed` saves to reduce storage writes. But the debounced
callback still writes the full blob:

```js
this.saveTimer = setTimeout(async () => {
  const speedToSave = this.pendingSave;
  await window.VSC.StorageManager.set({ ...this.settings, lastSpeed: speedToSave });
  //                                    ^^^^^^^^^^^^^^^^^ entire stale blob
}, this.SAVE_DELAY);
```

This made the race **worse**: the 1-second debounce delay creates a wider window where
`this.settings` can go stale before the write actually fires.

**Commit 4: `73e39e5` (2025-09-04) — "drop per-video logic & simplify"**

Removed the per-video speed storage (which was a partial mitigation — at least different
videos couldn't clobber each other). Now everything funnels through a single global
`lastSpeed`, amplifying the blast radius of every stale write.

### The 5 Concrete Race Windows

**Race 1: Options page clobbers speed (most common)**
```
T=0    Content script loads, reads lastSpeed=2.0 from storage
T=1    User opens options page, reads lastSpeed=2.0 into its own config instance
T=2    User changes speed to 3.0 on a video tab → content writes lastSpeed=3.0
T=3    User toggles "start hidden" on options page → options calls save({startHidden:true})
       save() does: this.settings = {...this.settings, startHidden:true}
       this.settings still has lastSpeed=2.0 (loaded at T=1, never refreshed)
       StorageManager.set(this.settings) → writes lastSpeed=2.0, overwriting 3.0 ← DATA LOSS
```

**Race 2: Debounce timer fires with stale context**
```
T=0    User changes speed to 1.5 → config.save({lastSpeed:1.5}) starts 1s timer
T=0.5  User opens options and saves startHidden=false → immediate full write
       this.settings has lastSpeed=1.5 (good so far), writes full blob
T=1.0  Debounce timer fires → writes {...this.settings, lastSpeed:1.5}
       But this.settings may have been mutated by other save() calls between T=0 and T=1
       The {...this.settings} spread captures whatever random state exists at T=1
```

**Race 3: Multiple tabs clobber each other**
```
Tab A reads settings (lastSpeed=1.0)
Tab B reads settings (lastSpeed=1.0)
Tab A: user sets speed to 2.0 → writes {lastSpeed:2.0, startHidden:false, ...all fields}
Tab B: user sets speed to 1.5 → writes {lastSpeed:1.5, startHidden:false, ...all fields}
       Tab B's write used its own stale this.settings, potentially overwriting other
       fields that Tab A had changed
```

**Race 4: Content script bridge loses writes**
The page-context `StorageManager.set()` (`storage-manager.js:88-103`) uses
`window.postMessage` to send writes to the content script, then optimistically updates
`window.VSC_settings`. But the content script's bridge handler
(`injection-bridge.js:42-43`) does a bare `chrome.storage.sync.set(data)` with no
merging — it writes exactly what it receives. If the page context sends a full blob with
stale fields, the content script faithfully persists the stale data.

**Race 5: Options page loads stale lastSpeed on open**
When the options page opens, it does `await config.load()` which reads storage once.
If the user then changes speed in another tab and comes back to save options, the
options page's `config.settings.lastSpeed` is the value from when the page opened,
not the current value. The save writes this stale speed back.

### What The Tests Miss

The test suite (`settings.test.js`, `ui-to-storage-flow.test.js`) has **zero
multi-context tests**. Every test creates a single `VideoSpeedConfig` instance and
exercises it in isolation. There is no test that:

1. Creates two config instances sharing the same mock storage
2. Has one instance write while the other reads
3. Verifies that concurrent writes don't clobber each other
4. Tests the debounce timer firing after another context has written

The debounce tests (`settings.test.js:92-218`) verify that rapid speed saves coalesce
correctly but never test what happens when the debounced write's `this.settings` snapshot
has gone stale.

### Three Fix Options Evaluated

#### Option A: Granular Writes (Minimal Change)

**Approach**: Change `save()` to only write the keys that were actually changed, never
the full blob. Add `chrome.storage.onChanged` listener to keep in-memory state fresh.

**Changes required**:
- `settings.js:save()` — Replace `StorageManager.set(this.settings)` with
  `StorageManager.set(newSettings)` (only write changed keys)
- `settings.js:save()` debounce path — Replace
  `StorageManager.set({...this.settings, lastSpeed})` with
  `StorageManager.set({lastSpeed})`
- `settings.js` — Add `StorageManager.onChanged()` listener in constructor to update
  `this.settings` when other contexts write
- `storage-manager.js` — Already supports `onChanged()`, no changes needed
- `injection-bridge.js:42-43` — Already forwards granular writes, no changes needed

**Pros**:
- Smallest diff (~30 lines changed)
- Eliminates all 5 race windows
- Backward compatible — `chrome.storage.sync.set({key: val})` merges atomically
- No migration needed

**Cons**:
- In-memory state can still be briefly stale between write and onChanged callback
- Doesn't address the options page constructing its own settings blob from DOM values
  (options.js:312-325 builds `settingsToSave` manually, which is fine for granular write
  since it only includes fields the user actually touched)

**Risk**: Low. `chrome.storage.sync.set()` with partial keys is the documented, intended
API usage.

#### Option B: Single-Writer Architecture via Background Service Worker

**Approach**: Route ALL storage writes through the background service worker. Content
scripts and options page send write requests via `chrome.runtime.sendMessage()`. The
background script serializes all writes, eliminating concurrency entirely.

**Changes required**:
- `background.js` — Add message handler for storage write requests, implement write
  queue
- `storage-manager.js` — Change `set()` to send messages to background instead of
  writing directly
- `settings.js` — Remove debounce logic (background handles serialization)
- `injection-bridge.js` — Route storage writes through runtime messaging instead of
  postMessage
- `content-entry.js` — Add message listener for write confirmations

**Pros**:
- Eliminates races by design (single serialized writer)
- Clean separation of concerns
- Easier to add features like write batching, conflict resolution

**Cons**:
- Significant architectural change (~200+ lines across 5 files)
- Adds latency to every write (message round-trip to service worker)
- Service worker can be suspended by Chrome, adding complexity for wake-up
- More failure modes (message channel errors, service worker crashes)
- Breaks the existing page-context → content-script → storage write path

**Risk**: Medium-High. Service worker lifecycle management in MV3 is notoriously tricky.
Suspended workers drop messages.

#### Option C: Optimistic Locking with Version Counter

**Approach**: Add a `_settingsVersion` counter to storage. Every write increments it.
Before writing, read the current version; if it's higher than expected, re-read storage
and retry the write with merged state.

**Changes required**:
- `constants.js` — Add `_settingsVersion` to default settings
- `settings.js:save()` — Implement read-compare-increment-write cycle
- `storage-manager.js` — Add `getAndSet()` atomic operation (read + conditional write)
- `settings.js` — Add retry logic with back-off for version conflicts
- Test infrastructure — Add multi-context concurrency tests

**Pros**:
- Formally correct concurrency control
- Detects and resolves conflicts explicitly
- Could log/report conflict frequency for monitoring

**Cons**:
- `chrome.storage.sync` has no compare-and-swap primitive, so the "atomic" check isn't
  truly atomic — there's still a TOCTOU window between reading the version and writing
- Significant complexity for a problem that Option A solves more simply
- Retry loops add unpredictable latency
- Over-engineered for the actual access pattern (low-frequency writes from 2-3 contexts)

**Risk**: Medium. The lack of true CAS in chrome.storage means this approach can't
fully eliminate races, only reduce their window. Adds complexity without guaranteeing
correctness.

### Recommendation: Option A (Granular Writes)

**Option A is the clear winner.** Here's why:

1. **It eliminates the root cause, not the symptom.** The bug is "writing fields you
   didn't change." The fix is "don't write fields you didn't change." This is the
   simplest possible correct solution.

2. **It uses the API as designed.** `chrome.storage.sync.set({lastSpeed: 2.0})` only
   updates `lastSpeed` and leaves all other keys untouched. This is atomic at the
   Chrome storage layer. No additional locking or serialization needed.

3. **It's the smallest diff.** ~30 lines of real changes across 2 files, plus an
   onChanged listener for in-memory freshness. Easy to review, easy to test, easy to
   revert if something unexpected happens.

4. **Option B is over-engineered.** A single-writer architecture solves the problem but
   introduces service worker lifecycle complexity that is worse than the original bug.

5. **Option C doesn't actually work.** Without CAS, version counters in
   `chrome.storage.sync` are still vulnerable to TOCTOU races. It's more complex AND
   less correct than Option A.

### Implementation Plan (Option A)

**Step 1: Make `save()` write only changed keys** (settings.js)
```js
async save(newSettings = {}) {
  // Update in-memory settings immediately
  this.settings = { ...this.settings, ...newSettings };

  const keys = Object.keys(newSettings);
  if (keys.length === 1 && keys[0] === 'lastSpeed') {
    // Debounce speed saves — write ONLY lastSpeed
    this.pendingSave = newSettings.lastSpeed;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      await window.VSC.StorageManager.set({ lastSpeed: this.pendingSave });
      this.pendingSave = null;
      this.saveTimer = null;
    }, this.SAVE_DELAY);
    return;
  }

  // Write ONLY the changed keys, not the full blob
  await window.VSC.StorageManager.set(newSettings);
}
```

**Step 2: Add onChanged listener to keep in-memory state fresh** (settings.js)
```js
constructor() {
  this.settings = { ...window.VSC.Constants.DEFAULT_SETTINGS };
  this.pendingSave = null;
  this.saveTimer = null;
  this.SAVE_DELAY = 1000;

  // Listen for changes from other contexts (options page, other tabs)
  window.VSC.StorageManager.onChanged((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in this.settings && newValue !== undefined) {
        this.settings[key] = newValue;
      }
    }
  });
}
```

**Step 3: Fix the debounced write to not spread stale state** (settings.js)
Already handled in Step 1 — the debounced path writes `{ lastSpeed: value }` instead of
`{ ...this.settings, lastSpeed: value }`.

**Step 4: Add multi-context concurrency tests** (new test file)
- Test: two config instances, one writes speed, other writes startHidden → neither
  clobbers the other
- Test: debounced write fires after another context wrote → doesn't revert
- Test: onChanged listener updates in-memory state from external writes

**Step 5: Verify options page save path** (options.js)
The options page already constructs `settingsToSave` with only the fields from the form.
With granular writes, this naturally only writes the fields the user changed. No changes
needed to options.js.

**Files to change**: `src/core/settings.js` (primary), new test file
**Estimated diff**: ~50 lines of production code, ~100 lines of tests
**Risk**: Low — uses documented Chrome API behavior, minimal architectural change
