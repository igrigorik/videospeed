# Contributing

Video Speed Controller is an open source project licensed under the MIT license
with many contributors. Contributions are welcome, and greatly appreciated.

If you would like to help, getting started is easy.

## Get Started

1. You must have a github account and be logged in
2. Fork the repo by clicking the "Fork" link on the top-right corner of the page
3. Once the fork is ready, clone to your local PC

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

4. Create a branch for your changes

   ```sh
    $ cd videospeed
    videospeed$ git checkout -b bugfix/1-fix-double-click
    M   .github/workflows/chrome-store-upload.yaml
    M   README.md
    M   options.js
    Switched to a new branch 'bugfix/1-fix-double-click'
    videospeed$
   ```

5. Open the code in your favorite code editor, make your changes

   ```sh
   echo "Awesome changes" > somefile.js
   git add .
   ```

   > Important: Your commit must be formatted using
   > [prettier](https://prettier.io/). If it is not it may be autoformatted for
   > you or your pull request may be rejected.

6. Next, open Chrome/Brave/Chromium and enable developer mode via
   `Settings > Extensions > Manage Extensions` and toggle `Developer mode` in
   the top-right corner.
7. Click `Load unpacked` and browse to the folder you cloned videospeed to.
8. Try out your changes, make sure they work as expected
9. Commit and push your changes to github

   ```sh
   git commit -m "Awesome description of some awesome changes."
   git push
   ```

10. Open your branch up on the github website then click `New pull request` and
    write up a description of your changes.

## Optional

### Run Pre-Commit Checks Locally

Installing [pre-commit](https://pre-commit.com/) is easy to do (click the link
for instructions on your platform). This repo comes with pre-commit already
configured. Doing this will ensure that your project is properly formatted and
runs some very basic tests. Once you have pre-commit installed on your system,
simply enter `pre-commit install` in your terminal in the folder to have these
checks run automatically each time you commit.

Even better, after issueing the install command you can now manually run
pre-commit checks before committing via `pre-commit run --all-files`

### Pull Upstream Changes

You should always be working with the latest version of the tool to make pull
requests easy. If you want to do this easily, just add a second remote to your
local git repo like this
`git remote add upstream https://github.com/igrigorik/videospeed.git`

Now any time you like to pull the latest version in to your local branch you can
simply issue the command `git pull upstream master`
