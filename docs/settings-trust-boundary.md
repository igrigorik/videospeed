# Settings trust boundary

How stored settings reach a page, and what a page can make the extension store. The content bridge (ISOLATED world) and the page script (MAIN world) implement this contract; `src/utils/runtime-settings.js` is its core.

## Invariants

- **D1 — Explicit disclosure.** Every bridge-to-page payload is built from a schema. Nothing is forwarded as stored: not settings, not a storage change record, not a runtime message.
- **D2 — Noninterference.** For the same document URL, resolved policy, and runtime preferences, different private settings produce identical payloads and identical event presence. This is a data-flow property; timing is out of scope.
- **D3 — No copies.** The page script's config, caches, and logs hold no private configuration.
- **D4 — Session isolation.** A storage change from another context never replaces an initialized document's speed authority.
- **W1 — Trusted persistence.** A page can ask for exactly one write, a remembered speed, and it succeeds only while the bridge is active and the stored `rememberSpeed` is on. Nothing the page says can grant it.

Private means site rules, the legacy blacklist, `enabled`, a remembered speed that is not in use, storage metadata, and any key the projection does not list.

## The handshake

The page script fires `VSC_REQUEST_SETTINGS` and the bridge answers `VSC_SETTINGS_READY` once. The request carries nothing the bridge trusts: policy is resolved against the frame's own `location.href`.

- **VSC is off for the document:** the detail is exactly `{ abort: true }`. That covers a disabled extension, a first matching site rule that is disabled, an inherited `about:` frame, and a failed startup read. A document that saw the extension disabled at any point stays off until it reloads.
- **VSC is on:** the detail is `{ settings }`, holding exactly `initialSpeed` and the nine runtime preferences: `rememberSpeed`, `exclusiveKeys`, `audioBoolean`, `startHidden`, `controllerOpacity`, `controllerButtonSize`, `customCSS`, `keyBindings`, `logLevel`.

The bridge keeps one copy of sync storage: the startup read with every later change applied, including changes that outrun the read. It resolves the answer once, from the latest state, when the request arrives. Rule edits after that take effect on the next load.

### Initial speed

The page gets one resolved speed, never a rule speed and a remembered speed side by side:

1. The first matching rule's speed, if valid, whether or not speed is remembered.
2. Otherwise, only if `rememberSpeed` is on, the remembered speed: the saved `lastSpeed`, or its default `1` when none was ever saved. A saved speed that is unusable gives `null`.
3. Otherwise `null`: VSC has no opinion. Never `1`.

A speed is valid when it is a positive number or numeric string, and is clamped to `0.07..16`. A remembered speed is also rounded to two decimals, on read and on write: the page script rounds every speed it persists, so finer precision was never written by VSC. Rule speeds stay as authored. A matching rule without a valid speed does not send the search on to later rules.

### Site rules

Every setting is its saved value, or its default when the key is absent. Nothing is written to storage to make defaults apply.

Rules are saved under two keys, so the rule list is the stored `siteRules`, where an empty list means no rules; else the stored legacy `blacklist`, read as disabled rules; else the default rules. `selectSiteRules` makes that choice. The bridge and the options page both call it, so what is displayed and what is enforced cannot differ.

Matching is first-match-wins over regexes with flags, domains, and URL substrings. An entry without a pattern string matches nothing.

## The options page

The options page loads the stored settings: rules through `selectSiteRules`, preferences through the same projection, and the remembered speed through the shared normalizer. Key bindings keep their stored form, since the page needs the metadata the projection strips. A legacy blacklist is shown as rules and saved as `siteRules` on the next save; nothing about rules is written on load.

## Where it lives

| Module                          | Role                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/utils/runtime-settings.js` | The projection: preference readers and defaults, speed rules, handshake answer, live diff |
| `src/utils/site-pattern.js`     | Site rules: defaults, rule source, URL matching                                           |
| `src/utils/messages.js`         | `VSC_MESSAGE` types and the command filter                                                |
| `src/entries/content-bridge.js` | Holds sync state; handshake, relay, write gate, commands                                  |
| `src/core/storage-manager.js`   | `requestRuntimeSettings()` for MAIN; direct storage calls for extension pages only        |
| `src/core/settings.js`          | `VideoSpeedConfig` for both contexts                                                      |

## Tests that guard it

- `tests/unit/utils/runtime-settings.test.js` covers the projection, speed resolution, and noninterference. Payloads are compared as serialized JSON, which is what crosses to the page; structural equality ignores key order and undefined-valued properties.
- A classification test in that file fails when a stored default is neither a runtime preference nor listed as private, so a new setting must be classified before it ships.
- `tests/unit/content/content-bridge.test.js` asserts on the events and writes of the real bridge, and `tests/unit/core/settings-runtime.test.js` on the page-script path.
- `tests/e2e/settings-boundary.e2e.js` runs the built extension in Chrome with a listener installed before any script. It serves `imgur.com` from memory to exercise the default rules offline.
