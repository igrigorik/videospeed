# Release Process

## Invariants

- `package.json` is the source of truth for the extension version. `package-lock.json` must carry the same root version.
- The checked-in `manifest.json` keeps `"version": "0.0.0"`; `scripts/build.mjs` writes the package version into `dist/manifest.json`.
- The release commit is pushed and passes CI before its tag is created.
- Each release gets one annotated tag. Push that tag explicitly; never use `git push --tags`.
- GitHub releases start as drafts and use the curated `docs/release-<version>.md` notes.
- Chrome Web Store upload is manual. No active workflow publishes to the store.

## Build modes

| Command                 | Minified | Use case                          |
| ----------------------- | -------- | --------------------------------- |
| `npm run build`         | No       | Local development and debugging   |
| `npm run build:release` | Yes      | Release packaging                 |
| `npm run release`       | Yes      | Clean, verify, build, and package |

Both build modes inject the version from `package.json` into the generated manifest.

## 1. Finish implementation work

Commit and push all intended fixes before preparing release metadata. Wait for CI on the last implementation commit, and keep unrelated working-tree changes out of the release.

```bash
git status --short
git fetch origin
git log --oneline --decorate -5
```

Commit and push release-tooling or runbook changes before continuing, and require their own green CI run. The later release commit should contain only version metadata and finalized release notes.

## 2. Set the version without creating a commit or tag

Set the exact version rather than asking npm to infer `patch`, `minor`, or `major`:

```bash
VERSION=0.11.0
npm version "$VERSION" --no-git-tag-version --allow-same-version
```

`--no-git-tag-version` updates `package.json` and both root version fields in `package-lock.json` without committing or tagging. `--allow-same-version` also repairs a partially prepared tree where `package.json` was already changed.

Verify the three values agree:

```bash
node -e "const p=require('./package.json');const l=require('./package-lock.json');console.log({package:p.version,lock:l.version,root:l.packages[''].version})"
git diff -- package.json package-lock.json
```

Do not edit the placeholder version in `manifest.json`.

## 3. Finalize curated release notes

Update `docs/release-${VERSION}.md`, add every shipped user-facing fix, and remove the `Status: DRAFT` marker. Keep the document terse; architecture details belong in their dedicated docs.

The GitHub release helper rejects missing notes and any notes that still contain `Status: DRAFT`. It strips the document's leading title and status line when creating the GitHub release body.

## 4. Run local release gates

Install exactly the lockfile, run browser coverage, then run the reproducible release pipeline:

```bash
npm ci
npm run test:e2e
npm run release
```

`npm run release` performs:

1. `npm run clean`
2. `npm run lint`
3. `npm test`
4. `npm run test:tlc`
5. `npm run build:release`
6. `node scripts/package-release.js`

Inspect the generated archive before committing:

```bash
ZIP="release/videospeed-${VERSION}.zip"
unzip -t "$ZIP"
unzip -p "$ZIP" manifest.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
unzip -l "$ZIP"
shasum -a 256 "$ZIP"
```

Confirm the manifest reports `${VERSION}`, the archive contains only extension/runtime files, and no source maps or OS metadata are present.

## 5. Commit and push release metadata

Review the exact diff, then create one release-preparation commit:

```bash
git diff --check
git status --short
git diff
git add package.json package-lock.json "docs/release-${VERSION}.md"
git commit -m "Prepare v${VERSION} release"
git push origin master
RELEASE_SHA=$(git rev-parse HEAD)
```

Do not tag yet.

## 6. Require CI on the exact release commit

Find the `CI` run whose `headSha` equals `${RELEASE_SHA}` and wait for it:

```bash
gh run list --workflow CI --branch master --limit 5 --json databaseId,headSha,status,conclusion,url
gh run watch <run-id> --exit-status
gh run view <run-id> --json headSha,status,conclusion,url
```

The run must pass install, audit, lint, release build, Vitest, TLC, packaging, and artifact upload. A green run for an earlier commit is not sufficient.

Download the release candidate produced by that run and repeat the archive checks from step 4:

```bash
rm -rf "/tmp/videospeed-${VERSION}"
gh run download <run-id> --name videospeed-release-node-22.x --dir "/tmp/videospeed-${VERSION}"
cp "/tmp/videospeed-${VERSION}/videospeed-${VERSION}.zip" release/
ZIP="release/videospeed-${VERSION}.zip"
unzip -t "$ZIP"
unzip -p "$ZIP" manifest.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
shasum -a 256 "$ZIP"
```

Use this CI-produced archive for the Chrome Web Store upload. The GitHub release helper independently locates the same successful exact-commit run and downloads its artifact again before creating the draft.

## 7. Create and push the single release tag

After exact-commit CI succeeds, create one annotated tag pointing at the verified commit:

```bash
git tag -a "v${VERSION}" "$RELEASE_SHA" -m "v${VERSION}"
git push origin "v${VERSION}"
git ls-remote --tags origin "refs/tags/v${VERSION}" "refs/tags/v${VERSION}^{}"
```

Never run `npm version patch|minor|major` followed by a manual tag: npm's default version command already commits and tags. Never push every local tag with `git push --tags`.

## 8. Create and review the draft GitHub release

First exercise every precondition without creating a release, then create the draft:

```bash
npm run release:github -- --dry-run
npm run release:github
```

The helper verifies that:

- the tracked and untracked worktree is clean;
- the curated notes are tracked, non-empty, and no longer marked draft;
- `HEAD` is exactly `origin/master`;
- the local tag is annotated and points at `HEAD`;
- the remote tag is the same annotated tag object and peels to `HEAD`;
- a successful `CI` push run exists for that exact commit;
- that run's `videospeed-release-node-22.x` artifact contains an intact zip with the expected manifest version and no source maps;
- GitHub operations target the explicit `github.com/owner/repository` derived from the `origin` URL, regardless of `GH_HOST`, `GH_REPO`, or current-directory overrides.

The non-dry run downloads the verified artifact again and creates a draft titled `v${VERSION}` with that zip and the curated notes. Review the draft on GitHub and independently confirm the tag, notes, archive name, manifest version, and checksum before publishing.

## 9. Publish and submit to the Chrome Web Store

Publishing the GitHub draft does not upload to the Chrome Web Store. Upload the exact same `release/videospeed-${VERSION}.zip` manually in the Chrome Web Store developer dashboard, complete the store review flow, and verify the published listing after approval.

## Recovery rules

- Before tagging, fix the release commit normally, push it, and require a fresh exact-commit CI run.
- After tagging but before publishing, stop rather than moving the tag silently. If the verified commit is wrong, delete the unpublished draft and coordinate a deliberate tag correction or choose a new version.
- After publishing, never move or reuse the tag. Fix forward with a new patch release.
