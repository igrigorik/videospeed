/**
 * Browser-level regression coverage for document-wide speed authority with
 * independent per-media conflict records. The fixture uses real extension
 * wiring; only site-originated register writes are deterministic test doubles.
 */

import { assert, launchChromeWithExtension, sleep } from './e2e-utils.js';

export default async function runSpeedArbitrationE2ETests() {
  console.log('🎭 Running Speed Arbitration E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;

  const runTest = async (name, test) => {
    try {
      console.log(`   🧪 ${name}`);
      await test();
      console.log(`   ✅ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`   ❌ ${name}: ${error.message}`);
      failed += 1;
    }
  };

  try {
    const launched = await launchChromeWithExtension();
    browser = launched.browser;
    const { page } = launched;
    const fixtureUrl = `file://${process.cwd()}/tests/e2e/dual-video.html`;
    const normalResetFixtureUrl = `file://${process.cwd()}/tests/e2e/test-video.html`;
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });

    // Opening an extension page can background the dual-video fixture and
    // defer media readiness, so create the storage page only for the later
    // persistence scenarios after the fixture lifecycle tests are complete.
    let storagePage = null;
    const getStoragePage = async () => {
      if (storagePage) {
        return storagePage;
      }
      const worker = await browser.waitForTarget((target) => target.type() === 'service_worker', {
        timeout: 15000,
      });
      const extensionId = new URL(worker.url()).host;
      storagePage = await browser.newPage();
      await storagePage.goto(`chrome-extension://${extensionId}/ui/options/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      return storagePage;
    };
    const resetStoredSpeed = async (speed) => {
      const extensionPage = await getStoragePage();
      return extensionPage.evaluate(async (lastSpeed) => {
        await new Promise((resolve) => chrome.storage.sync.clear(resolve));
        await new Promise((resolve) =>
          chrome.storage.sync.set(
            { enabled: true, rememberSpeed: true, lastSpeed, siteRules: [] },
            resolve
          )
        );
      }, speed);
    };
    const readStoredSpeed = async () => {
      const extensionPage = await getStoragePage();
      return extensionPage.evaluate(
        () =>
          new Promise((resolve) =>
            chrome.storage.sync.get('lastSpeed', ({ lastSpeed }) => resolve(lastSpeed))
          )
      );
    };

    const runNormalResetScenario = async (order) => {
      await resetStoredSpeed(2.1);
      const scenarioPage = await browser.newPage();
      try {
        // Register before MAIN-world document_idle listeners so the fixture
        // can observe the original native event even when VSC later stops it.
        await scenarioPage.evaluateOnNewDocument(() => {
          window.__vscNormalResetEvents = [];
          for (const type of ['seeking', 'seeked', 'ratechange']) {
            document.addEventListener(
              type,
              (event) => {
                if (event.target instanceof HTMLMediaElement) {
                  window.__vscNormalResetEvents.push({
                    type,
                    rate: event.target.playbackRate,
                    seeking: event.target.seeking,
                  });
                }
              },
              true
            );
          }
        });
        await scenarioPage.goto(normalResetFixtureUrl, { waitUntil: 'domcontentloaded' });
        await scenarioPage.waitForFunction(
          () => {
            const video = document.querySelector('video');
            return video?.readyState >= 2 && !!video.vsc && video.playbackRate === 2.1;
          },
          { timeout: 15000 }
        );

        const timing = await scenarioPage.evaluate(() => ({
          initGraceMs: window.VSC.IntentClassifier.MEDIA_INIT_GRACE_MS,
          saveDelayMs: window.VSC_controller.config.SAVE_DELAY,
        }));
        await scenarioPage.evaluate((scenarioOrder) => {
          const video = document.querySelector('video');
          const controls = document.createElement('div');
          controls.style.cssText =
            'position:fixed;right:10px;top:10px;z-index:2147483647;background:white;padding:8px';

          const openMenu = document.createElement('button');
          openMenu.id = 'vsc-normal-reset-open-menu';
          openMenu.textContent = 'Open speed menu';

          const chooseNormal = document.createElement('button');
          chooseNormal.id = 'vsc-normal-reset-choose-normal';
          chooseNormal.textContent = 'Choose Normal';
          chooseNormal.addEventListener('click', () => {
            const seekTarget = Math.min(video.duration - 1, video.currentTime + 5);
            if (scenarioOrder === 'seek-rate') {
              video.currentTime = seekTarget;
              video.playbackRate = 1.0;
            } else if (scenarioOrder === 'rate-seek') {
              video.playbackRate = 1.0;
              video.currentTime = seekTarget;
            } else {
              video.playbackRate = 1.0;
            }
          });

          controls.append(openMenu, chooseNormal);
          document.body.append(controls);
        }, order);

        // Attachment is intentionally negative evidence. Let it expire so
        // each case proves only its stated seek/menu behavior.
        await sleep(timing.initGraceMs + 100);
        await scenarioPage.evaluate(() => {
          window.__vscNormalResetEvents = [];
        });
        await scenarioPage.click('#vsc-normal-reset-open-menu');
        await sleep(100);
        await scenarioPage.click('#vsc-normal-reset-choose-normal');

        const expectedRate = order === 'menu-normal' ? 1.0 : 2.1;
        await scenarioPage.waitForFunction(
          (rate) =>
            window.__vscNormalResetEvents.some((event) => event.type === 'ratechange') &&
            Math.abs(document.querySelector('video').playbackRate - rate) < 0.001,
          { timeout: 5000 },
          expectedRate
        );
        // Accepted choices persist through the settings debounce; demoted
        // resets must leave the already-stored authority untouched.
        await sleep(timing.saveDelayMs + 200);

        const state = await scenarioPage.evaluate(() => ({
          earlyEvents: window.__vscNormalResetEvents,
          lastSpeed: window.VSC_controller.config.settings.lastSpeed,
          rate: document.querySelector('video').playbackRate,
        }));
        state.storedSpeed = await readStoredSpeed();
        return state;
      } finally {
        await scenarioPage.close();
      }
    };

    await runTest('two real media elements receive controllers', async () => {
      await page.waitForFunction(
        () => {
          const a = document.querySelector('#videoA');
          const b = document.querySelector('#videoB');
          return a?.readyState >= 2 && b?.readyState >= 2 && !!a.vsc && !!b.vsc;
        },
        { timeout: 15000 }
      );
      assert.equal(
        await page.evaluate(() => document.querySelectorAll('.vsc-controller').length),
        2,
        'Both fixture videos should have a controller'
      );
    });

    await runTest('VSC write echoes remain observable to media listeners', async () => {
      await page.evaluate(() => {
        const video = document.querySelector('#videoA');
        window.__vscObservedRateChanges = [];
        video.addEventListener(
          'ratechange',
          () => window.__vscObservedRateChanges.push(video.playbackRate),
          { once: true }
        );

        // The WRITE primitive registers an echo token before assigning the
        // media register. VSC should consume that token without hiding the
        // native event from target-level player listeners.
        video.vsc.actionHandler.writeRate(video, 1.25);
      });

      await page.waitForFunction(() => window.__vscObservedRateChanges?.length === 1, {
        timeout: 5000,
      });
      const state = await page.evaluate(() => {
        const videoRate = document.querySelector('#videoA').playbackRate;
        const observedRate = window.__vscObservedRateChanges[0];
        delete window.__vscObservedRateChanges;
        return { observedRate, videoRate };
      });

      assert.equal(state.videoRate, 1.25, 'The VSC write should update the media register');
      assert.equal(state.observedRate, 1.25, 'The media listener should observe the VSC write');
    });

    await runTest('A can surrender locally while B still enforces shared authority', async () => {
      const state = await page.evaluate(() => {
        const a = document.querySelector('#videoA');
        const b = document.querySelector('#videoB');
        const controller = window.VSC_controller;

        // Native playbackRate writes queue native ratechange events. Shadow the
        // test media registers so explicit synthetic site events exercise the
        // real EventManager exactly once and remain deterministic.
        for (const video of [a, b]) {
          let rate = video.playbackRate;
          Object.defineProperty(video, 'playbackRate', {
            configurable: true,
            get: () => rate,
            set: (value) => {
              rate = Number(value);
            },
          });
        }

        // This is the production VSC action path: it claims authority, writes
        // A, registers an echo token, and synchronizes the controller UI.
        a.vsc.actionHandler.adjustSpeed(a, 2.0);

        const siteRate = (video, rate) => {
          video.playbackRate = rate;
          video.dispatchEvent(new Event('ratechange', { bubbles: true }));
        };

        // Four autonomous resets are fought; the fifth exhausts only A's
        // local budget. B receives its own reset and must remain HOLDING.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          siteRate(a, 1.0);
        }
        siteRate(b, 1.0);

        const arbitration = controller.eventManager.arbitration;
        const conflictA = arbitration.conflicts.get(a);
        const conflictB = arbitration.conflicts.get(b);
        return {
          aRate: a.playbackRate,
          bRate: b.playbackRate,
          aMode: conflictA?.mode,
          bMode: conflictB?.mode,
          bFightCount: conflictB?.fightCount,
          lastSpeed: controller.config.settings.lastSpeed,
          authorityEpoch: arbitration.authorityEpoch,
        };
      });

      assert.equal(state.aRate, 1.0, 'A should retain the site rate after local surrender');
      assert.equal(state.bRate, 2.0, 'B should fight back to shared authority');
      assert.true(
        state.aMode === 'REARMABLE' || state.aMode === 'SUPPRESSED',
        `A should surrender locally, got ${state.aMode}`
      );
      assert.equal(state.bMode, 'HOLDING', 'B must remain locally enforcing');
      assert.equal(state.bFightCount, 1, 'B should spend only its own first fight');
      assert.equal(state.lastSpeed, 2.0, 'A surrender must not clear shared authority');
      assert.equal(state.authorityEpoch, 1, 'One VSC command should claim one epoch');
    });

    await runTest('a same-value VSC action starts a fresh epoch and re-arms A', async () => {
      const state = await page.evaluate(() => {
        const a = document.querySelector('#videoA');
        const arbitration = window.VSC_controller.eventManager.arbitration;
        const before = arbitration.authorityEpoch;

        // 2.0 is already the document authority. The explicit action must
        // still start a new epoch and replace A's locally surrendered state.
        a.vsc.actionHandler.adjustSpeed(a, 2.0);
        const conflictA = arbitration.conflicts.get(a);
        return {
          before,
          after: arbitration.authorityEpoch,
          aRate: a.playbackRate,
          mode: conflictA?.mode,
          fightCount: conflictA?.fightCount,
          rearmBudget: conflictA?.rearmBudget,
        };
      });

      assert.equal(state.after, state.before + 1, 'Same-value action must advance authority epoch');
      assert.equal(state.aRate, 2.0, 'Fresh authority should write A back to 2.0');
      assert.equal(state.mode, 'HOLDING', 'Fresh authority should re-arm A');
      assert.equal(state.fightCount, 0, 'Fresh authority should clear A fight count');
      assert.equal(state.rearmBudget, 1, 'Fresh authority should restore A re-arm budget');
    });

    await runTest('an unready removed video retires its deferred listener', async () => {
      await page.evaluate(() => {
        const video = document.createElement('video');
        video.id = 'videoC';
        window.__vscDeferredVideo = video;
        document.querySelector('#test-area').append(video);
      });
      // Allow the real MutationObserver to install its loadeddata deferral.
      await sleep(200);
      await page.evaluate(() => window.__vscDeferredVideo.remove());
      // Wait for the real MutationObserver removal callback instead of
      // relying on scheduling luck before checking its listener cleanup.
      await page.waitForFunction(
        () => !window.VSC_controller.deferredMediaListeners.has(window.__vscDeferredVideo),
        { timeout: 5000 }
      );

      const state = await page.evaluate(() => {
        const video = window.__vscDeferredVideo;
        const extension = window.VSC_controller;
        const listenerRetired = !extension.deferredMediaListeners.has(video);
        // If the listener survived removal, this would enter onVideoFound's
        // ready-media branch and expose a resurrection bug.
        Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
        video.dispatchEvent(new Event('loadeddata'));
        delete window.__vscDeferredVideo;
        return {
          listenerRetired,
          isConnected: video.isConnected,
          hasController: !!video.vsc,
        };
      });

      assert.true(state.listenerRetired, 'Removing C should cancel its loadeddata listener');
      assert.false(state.isConnected, 'C should be removed before metadata arrives');
      assert.false(state.hasController, 'Deferred loadeddata must not resurrect C');
      assert.equal(
        await page.evaluate(() => document.querySelectorAll('.vsc-controller').length),
        2,
        'Only A and B controllers should remain'
      );
    });

    await runTest('teardown cancels deferred media before it can attach', async () => {
      await page.evaluate(() => {
        const video = document.createElement('video');
        video.id = 'videoD';
        document.querySelector('#test-area').append(video);
      });
      await sleep(200);

      const state = await page.evaluate(() => {
        const video = document.querySelector('#videoD');
        const extension = window.VSC_controller;
        extension.teardown();
        Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
        video.dispatchEvent(new Event('loadeddata'));
        return {
          initialized: extension.initialized,
          hasController: !!video.vsc,
          controllerCount: document.querySelectorAll('.vsc-controller').length,
        };
      });

      assert.false(state.initialized, 'Extension should remain torn down');
      assert.false(state.hasController, 'Deferred D must not attach after teardown');
      assert.equal(state.controllerCount, 0, 'Teardown should remove A and B without resurrection');
    });

    await runTest('seek-before-rate reset preserves remembered authority', async () => {
      const state = await runNormalResetScenario('seek-rate');
      const eventTypes = state.earlyEvents.map((event) => event.type);
      const seekingIndex = eventTypes.indexOf('seeking');
      const rateChangeIndex = eventTypes.indexOf('ratechange');
      const firstRateChange = state.earlyEvents[rateChangeIndex];
      assert.true(
        seekingIndex >= 0 && rateChangeIndex >= 0 && seekingIndex < rateChangeIndex,
        `Expected seeking before ratechange, got ${eventTypes.join(' -> ')}`
      );
      assert.equal(firstRateChange.rate, 1.0, 'The original site event should carry the 1.0 reset');
      assert.equal(state.rate, 2.1, 'The seek-side reset should be fought');
      assert.equal(state.lastSpeed, 2.1, 'The seek-side reset must not replace session authority');
      assert.equal(state.storedSpeed, 2.1, 'The seek-side reset must not corrupt storage');
    });

    await runTest('rate-before-seeking-event reset uses live media state', async () => {
      const state = await runNormalResetScenario('rate-seek');
      const eventTypes = state.earlyEvents.map((event) => event.type);
      const rateChangeIndex = eventTypes.indexOf('ratechange');
      const seekingIndex = eventTypes.indexOf('seeking');
      const firstRateChange = state.earlyEvents[rateChangeIndex];
      assert.true(
        rateChangeIndex >= 0 && seekingIndex >= 0 && rateChangeIndex < seekingIndex,
        `Expected ratechange before seeking, got ${eventTypes.join(' -> ')}`
      );
      assert.equal(firstRateChange.rate, 1.0, 'The original site event should carry the 1.0 reset');
      assert.true(
        firstRateChange.seeking === true,
        'The media must expose seeking=true before its seeking event is delivered'
      );
      assert.equal(state.rate, 2.1, 'The early rate reset should be fought');
      assert.equal(state.lastSpeed, 2.1, 'The early rate reset must not replace session authority');
      assert.equal(state.storedSpeed, 2.1, 'The early rate reset must not corrupt storage');
    });

    await runTest('native menu Normal remains an intentional durable choice', async () => {
      const state = await runNormalResetScenario('menu-normal');
      assert.false(
        state.earlyEvents.some((event) => event.type === 'seeking'),
        'The menu-only fixture must not supply seek evidence'
      );
      assert.equal(state.rate, 1.0, 'An intentional Normal choice should remain at 1.0');
      assert.equal(state.lastSpeed, 1.0, 'An intentional Normal choice should claim authority');
      assert.equal(state.storedSpeed, 1.0, 'An intentional Normal choice should persist');
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed += 1;
  } finally {
    await browser?.close();
  }

  console.log(`\n   📊 Speed Arbitration E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
