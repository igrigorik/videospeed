# Contributing

Video Speed Controller is an open source project licensed under the MIT license
with many contributors. Contributions are welcome, and greatly appreciated.

If you would like to help, getting started is easy.

## Get Started

### Windows Prerequisites

The build scripts and tests are cross-platform, but Git hooks (Husky) require
a POSIX shell. Windows users need:

1. **[Git for Windows](https://git-scm.com/download/win)** — provides the
   `sh.exe` that Husky hooks run under. Use Git Bash or a terminal backed by
   Git's bundled shell.
2. **Node.js >= 22.13** — install via any version manager that reads `.nvmrc`
   ([fnm](https://github.com/Schniz/fnm), [nvm-windows](https://github.com/coreybutler/nvm-windows),
   [volta](https://volta.sh/), etc.). Make sure Node is available in both your
   regular terminal and Git Bash.
3. **Husky + Node in hooks** — Husky hooks run in a non-interactive shell where
   your shell profile isn't sourced. If hooks fail with "node not found", add
   your version manager's init to `~/.config/husky/init.sh` (Husky sources this
   before every hook). For example with fnm:
   ```sh
   echo 'eval "$(fnm env)"' >> ~/.config/husky/init.sh
   ```

### Contribution Process

1. You must have a github account and be logged in
2. Open <https://github.com/igrigorik/videospeed/>
3. Fork the repo by clicking the "Fork" link on the top-right corner of the page
4. Once the fork is ready, clone to your local PC

   ```sh
   $ git clone https://github.com/<USERNAME>/videospeed.git
   Cloning into 'videospeed'...
    remote: Enumerating objects: 10, done.
    remote: Counting objects: 100% (10/10), done.
    remote: Compressing objects: 100% (9/9), done.
    remote: Total 877 (delta 3), reused 2 (delta 1), pack-reused 867
    Receiving objects: 100% (877/877), 317.65 KiB | 2.17 MiB/s, done.
    Resolving deltas: 100% (543/543), done.
   ```

5. Create a branch for your changes

   ```sh
    $ cd videospeed
    videospeed$ git checkout -b bugfix/1-fix-double-click
    M   .github/workflows/chrome-store-upload.yaml
    M   README.md
    M   options.js
    Switched to a new branch 'bugfix/1-fix-double-click'
    videospeed$
   ```

6. Open the code in your favorite code editor, make your changes

   ```sh
   echo "Awesome changes" > somefile.js
   git add .
   ```

   > Important: Your commit must be formatted using
   > [prettier](https://prettier.io/). If it is not it may be autoformatted for
   > you or your pull request may be rejected.

7. Next, open Chrome/Brave/Chromium and enable developer mode via
   `Settings > Extensions > Manage Extensions` and toggle `Developer mode` in
   the top-right corner.

8. Install dependencies

   ```sh
   npm install
   ```

9. Build the extension

   ```sh
   npm run build
   ```

10. Click `Load unpacked` and select the `dist/` folder (the build output).

11. Try out your changes, make sure they work as expected

12. Commit and push your changes to github

    ```sh
    git commit -m "Awesome description of some awesome changes."
    git push
    ```

13. Open your branch up on the github website then click `New pull request` and
    write up a description of your changes.

## Changing speed behavior

Anything that affects how VSC decides `video.playbackRate` — fight-back,
adoption of native speed changes, lifecycle restores, site rules — is
governed by the arbitration contract in `docs/speed-arbitration.md`
(machine-checked twin: `specs/SpeedArbiter.tla`). PRs touching speed
behavior must identify which transition-table cell(s) they change and
why. Classifier heuristics (gesture evidence) must cite the issue that
motivated them. `npm test` runs the JavaScript conformance and differential
suites. Run `npm run test:tlc` separately for the pinned two-media TLA+
model; it requires Java 11 or newer and downloads a checksum-verified TLC
artifact outside the repository. CI runs both commands. Changes to shared/local
arbitration or controller lifecycle should also run `npm run build && node
tests/e2e/run-e2e.js arbitration` for the two-media browser fixture.

## Optional

### Run Git Hooks Manually

Running `npm install` configures the repository's Husky hooks. Commits run
`npx lint-staged` to format and lint staged files, while pushes run the full
lint and test suites.

You can run the same checks manually:

```sh
npx lint-staged
npm run lint
npm test
npm run test:tlc
```

### Pull Upstream Changes

You should always be working with the latest version of the tool to make pull
requests easy. If you want to do this easily, just add a second remote to your
local git repo like this
`git remote add upstream https://github.com/igrigorik/videospeed.git`

Now any time you like to pull the latest version in to your local branch you can
simply issue the command `git pull upstream master`
