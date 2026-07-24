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
    await page.goto(`file://${process.cwd()}/tests/e2e/dual-video.html`, {
      waitUntil: 'domcontentloaded',
    });

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
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed += 1;
  } finally {
    await browser?.close();
  }

  console.log(`\n   📊 Speed Arbitration E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
