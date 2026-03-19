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
