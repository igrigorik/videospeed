# Release 0.11.2

## Fixes

- Restored the default disabled sites (`imgur.com`, `teams.microsoft.com`) on installs that never saved options; they had been left enabled since 0.10.0.
- Showed sites disabled in versions before 0.10.0 as site rules on the options page, where the defaults had appeared instead, and kept them on save.
- Kept the extension working when imported settings contain a malformed site rule.
- Ignored popup speed commands that arrive while a page is still starting, instead of raising an error.
- Ignored extension messages that arrive without a payload, instead of raising an error (#1622).
- Disconnected Shadow DOM observers when the extension is disabled on a page (#1635).

## Hardening and maintenance

- Hardened how the extension shares settings with its page script; the contract is documented in `docs/settings-trust-boundary.md` and covered by real-Chrome tests.
- Updated development dependencies flagged by `npm audit`.
- Fixed the lint and format scripts on Windows (#1619).
