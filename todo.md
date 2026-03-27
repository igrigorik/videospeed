# ESLint 10 cleanup — 20 manual fixes

After migrating to eslint 10 + flat config, 20 errors remain that
need manual review (not auto-fixable). Each needs reading the
surrounding code to make the right call.

## Unused catch variables (use bare `catch` or `catch (_e)`)

These catches don't use the error object. Modern JS allows `catch { }`
with no binding. If the error IS used in the body (e.g., for logging),
keep the binding.

- `src/site-handlers/facebook-handler.js:31` — catch (e) not used
- `src/site-handlers/youtube-handler.js:168` — catch (e) not used
- `src/ui/options/options.js:102` — catch (e) not used
- `src/ui/options/options.js:229` — catch (e) not used
- `src/ui/options/options.js:589` — catch (err) not used
- `src/ui/options/options.js:879` — catch (e) not used
- `src/utils/blacklist.js:44` — catch (err) not used
- `src/utils/dom-utils.js:15` — catch (e) not used
- `src/utils/event-manager.js:42` — catch (e) not used
- `src/utils/site-pattern.js:44` — catch (err) not used

## Unused function args (prefix with `_` or remove)

- `src/background.js:195` — `sender` param in onMessage listener, not used
- `src/ui/popup/popup.js:129` — `slowerStep`, `fasterStep` destructured but never read
- `src/ui/popup/popup.js:178` — `resetSpeed` assigned but never read

## Dead code / useless assignment

- `src/site-handlers/facebook-handler.js:25` — `targetParent = parent` immediately
  overwritten in both try/catch branches. Use `let targetParent;` instead.

## Strict equality

- `src/site-handlers/scripts/netflix.js:2` — two `!=` should be `!==`
- `src/ui/options/row-renderer.js:46,61` — two `!=` should be `!==`

## New rule: preserve-caught-error

- `src/ui/options/options.js:880` — `throw new Error(...)` inside catch block
  doesn't attach the original error as `cause`. Should be
  `throw new Error('...', { cause: e })`.
