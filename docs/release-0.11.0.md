# Release 0.11.0

## Playback

- Rebuilt speed decisions around a single arbitration engine that adopts native player choices, bounds site conflicts, and distinguishes user actions from automatic player changes.
- Restored YouTube click-and-hold and spacebar hold-for-2x, including restoration of the prior VSC speed on release (#1554, #1568).
- Prevented arrow-key seeking and progress-bar clicks from resetting playback speed (#1546, #1562, #1581).
- Stopped VSC from overriding native speed controls at page load when it has no speed to assert; speeds selected through native menus now persist (#1521, #1537).
- Isolated speed authority per tab; remembered speed seeds new or reloaded tabs without changing other open tabs (#1559).
- Made per-site speeds overridable session defaults rather than permanent enforcement.
- Bounded repeated site resets to four retries per conflict, forgave isolated resets, and allowed later user actions to re-engage enforcement.
- Isolated conflict state per media element so one hostile player cannot disable control of other videos on the page.
- Replaced the post-write cooldown with exact write-echo filtering, keeping native `ratechange` events visible to player listeners and auxiliary media synchronization (#1552).
- Saved remembered speed only for user-authorized changes, not automatic restores or site events.

## Controller and site fixes

- Fixed V-key show/hide across automatic player UI fading; the first press flips current visibility and later presses alternate persistent show/hide intent (#1584).
- Fixed centered and doubly offset controllers in positioned, flex, and grid layouts, including Udemy and TVer; added Frame.io viewport handling (#1557, #1558, #1570).
- Restored controller visibility and interaction in modern YouTube and youtube-nocookie embeds, and stopped YouTube-only CSS selectors from affecting unrelated sites (#1501).
- Moved the controller below YouTube Shorts play and volume controls (#1522).
- Preserved browser pinch/Ctrl+wheel zoom over the controller instead of changing playback speed (#1539).
- Enabled Instagram by default for new installs and restored defaults while preserving existing user rules (#1564).

## Lifecycle and reliability

- Fixed disabled-site startup races: queued work is cancelled, inherited `about:` frames fail closed, and re-enable takes effect after reload (#1527).
- Added TLA+ models plus differential and real-Chrome regression coverage for speed arbitration and controller visibility; CI now checks both models.
- Upgraded the build and test toolchain, migrated ESLint configuration, adapted release packaging to Archiver 8, and cleared known npm audit findings.
- Corrected contributor hook guidance and cleaned obsolete repository ignore entries.

**Credits:** @rdavidwu (#1537), @sharno (#1563), and @Tredecate (#1555).
