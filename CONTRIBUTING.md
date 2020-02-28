# Contributing

Video Speed Controller is an open source project licensed under the MIT license
with many contributers. Contributions are welcome, and greatly appreciated.

If you would like to help, getting started is easy.

## Bug Reporting

Even if you have no development experience, submitting a thorough bug report can
be just as good of a contribution. Here's some tips on how to best do that.

1. Visit the
   [video speed controller issues page](https://github.com/igrigorik/videospeed)
2. Search for any open (or closed) issues that may match the issue you are
   experiencing. Sometimes there will be some really good instructions on how to
   solve your issue here
3. If you're unable to find an issue, click the green
   [New Issue](https://github.com/igrigorik/videospeed/issues/new) button on the
   top-right
4. Enter a descriptive title
5. Enter the issue you're experiencing, with detailed instructions on how to
   reproduce the error. Specific steps with a link to the specific page you're
   having trouble with are greatly appreciated.
6. Click "Submit new issue"
7. Remember that this is an open source project, offered completely for free by
   volunteers so you may not get an immediate response but we try to respond to
   all requests

### Reporting with Gherkin

This isn't required, but if you're familiar with the
[gherkin](https://cucumber.io/docs/gherkin/reference/) syntax, you can try
including a gherkin formatted script describing the expected behavior. We can
add this to the code for future tests

```gherkin
Feature: Change video speed

   Given a website with a video on it
   When I press the hotkey to increase the speed
   Then the speed increases
```

## Developer Guide

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
    Switched to a new branch 'bugfix/1-fix-double-click'
    videospeed$
   ```

5. Install [nodejs & npm](https://nodejs.org/) if you don't have it, then run
   `npm install`

   ```sh
   videospeed$ npm install
   audited 1204237 packages in 8.247s

   25 packages are looking for funding
   run `npm fund` for details

   found 0 vulnerabilities
   ```

   > NOTE: You can skip this step but if the tests fail your pull request will
   > be automatically rejected due to being unable to build

6. Open the code in your favorite code editor, make your changes

   ```sh
   echo "Awesome changes" > somefile.js
   git add .
   ```

   > Important: Your commit will be automatically formatted using
   > [prettier](https://prettier.io/) when `npm test` is ran. This happens
   > automatically on your computer before you commit and server side after you
   > commit. Adding tests with your commit is welcomed and encouraged

7. Next, open Chrome/Brave/Chromium and enable developer mode via
   `Settings > Extensions > Manage Extensions` and toggle `Developer mode` in
   the top-right corner.
8. Click `Load unpacked` and browse to the folder you cloned videospeed to.
9. Run `npm test` to ensure all tests are passing (update them if necessary)
10. Try out your changes, make sure they work as expected
11. Commit and push your changes to github

```sh
git commit -m "Awesome description of some awesome changes."
git push
```

12. Open your branch up on the github website then click `New pull request` and
    write up a description of your changes.

## Optional

### Pull Upstream Changes

You should always be working with the latest version of the tool to make pull
requests easy. If you want to do this easily, just add a second remote to your
local git repo like this
`git remote add upstream https://github.com/igrigorik/videospeed.git`

Now any time you like to pull the latest version in to your local branch you can
simply issue the command `git pull upstream master`

### Live Test Runner

The JavaScript testing framework in use, [jest](https://jestjs.io/), allows for
easily following the popular
[Test Driven Development](https://www.agilealliance.org/glossary/tdd/)
programming style. Simply issue the command `npm run test-live` and your tests
will be ran every time you save.

```sh
 PASS  examples/sum.test.js
  √ adds 1 + 2 to equal 3 (2ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        1.869s
Ran all test suites.

Watch Usage
 › Press f to run only failed tests.
 › Press o to only run tests related to changed files.
 › Press p to filter by a filename regex pattern.
 › Press t to filter by a test name regex pattern.
 › Press q to quit watch mode.
 › Press Enter to trigger a test run.
```

### BDD/Cucumber/Gherkin

While on the subject, testing using
[Behavior Driven Development](https://en.wikipedia.org/wiki/Behavior-driven_development)
in this project is supported and encouraged. Start by creating a .feature file
in the features folder. Check out the
[cucumber-js docs](https://github.com/cucumber/cucumber-js) for more
information.

Run your scenarios using `npm cucumber` or just use `npm test` to run all tests

```sh
$ npm run cucumber

> videospeed@0.5.9 cucumber /home/chad/videospeed
> cucumber-js

............

4 scenarios (4 passed)
12 steps (12 passed)
0m00.003s

```

### Linting

This project uses [prettier.io](https://prettier.io/) for linting and styling.
This is done automatically client side as a
[pre-commit hook](https://github.com/typicode/husky#readme) before you commit
your code as well as any time you run `npm test` or `npm run lint`. This is also
done server-side to incoming pull requests
