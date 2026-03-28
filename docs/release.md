# Release Process

## How versioning works

`package.json` is the single source of truth for the extension version. The checked-in `manifest.json` contains `"version": "0.0.0"` as a placeholder. At build time, `scripts/build.mjs` reads the version from `package.json` and writes it into `dist/manifest.json`.

## Build modes

| Command                 | Minified | Use case                     |
| ----------------------- | -------- | ---------------------------- |
| `npm run build`         | No       | Local development, debugging |
| `npm run build:release` | Yes      | CI, release packaging        |

Both modes inject the version from `package.json` into the manifest identically.

## Cutting a release

```bash
# 1. Bump version (creates a commit automatically)
npm version patch   # or minor, major

# 2. Run the release pipeline: clean -> test -> build:release -> zip
npm run release

# 3. Tag and push
git tag v$(node -p "require('./package.json').version")
git push origin main --tags

# 4. Create a draft GitHub release (requires gh CLI)
npm run release:github

# 5. Review the draft on GitHub, then publish
# 6. Upload release/videospeed-*.zip to the Chrome Web Store
```

## What `npm run release` does

1. **`prerelease`** -- runs `clean` (removes `dist/` and `release/`) then `npm test`
2. **`build:release`** -- runs esbuild with `RELEASE=1` (minification enabled)
3. **`package-release.js`** -- creates `release/videospeed-{version}.zip`:
   - Validates manifest version matches `package.json`
   - Excludes source maps and `.DS_Store`
   - Warns if the zip exceeds the Chrome Web Store 128 MB limit

## What `npm run release:github` does

- Verifies `gh` CLI is installed and authenticated
- Verifies the git tag exists
- Auto-generates release notes from commits since the previous tag
- Creates a **draft** release on GitHub with the zip attached
- Draft requires manual review before publishing

## Quality gates

| Hook       | Runs                                               | When              |
| ---------- | -------------------------------------------------- | ----------------- |
| Pre-commit | `lint-staged` (eslint + prettier on changed files) | Every commit      |
| Pre-push   | `npm run lint` + `npm test`                        | Every push        |
| CI         | lint, build:release, test, package zip             | Push/PR to master |

CI uploads the versioned zip as an artifact, so every passing build on master produces a release candidate.
