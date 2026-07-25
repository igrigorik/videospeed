import { launchChromeWithExtension, sleep } from './e2e-utils.js';

export default async function runLifecycleE2ETests() {
  console.log('🔒 Running Lifecycle E2E Tests...');

  let browser;
  let passed = 0;
  let failed = 0;

  const runTest = async (name, test) => {
    try {
      console.log(`   🧪 ${name}`);
      await test();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`   ❌ ${name}: ${error.message}`);
      failed++;
    }
  };

  try {
    const launched = await launchChromeWithExtension();
    browser = launched.browser;
    const { page } = launched;
    const worker = await browser.waitForTarget((target) => target.type() === 'service_worker', {
      timeout: 15000,
    });
    const extensionId = new URL(worker.url()).host;
    const storagePage = await browser.newPage();
    await storagePage.goto(`chrome-extension://${extensionId}/ui/options/options.html`, {
      waitUntil: 'domcontentloaded',
    });

    const clearStorage = () =>
      storagePage.evaluate(() => new Promise((resolve) => chrome.storage.sync.clear(resolve)));
    const setStorage = (settings) =>
      storagePage.evaluate(
        (values) => new Promise((resolve) => chrome.storage.sync.set(values, resolve)),
        settings
      );
    const fixtureUrl = `file://${process.cwd()}/tests/e2e/lifecycle.html`;

    await clearStorage();

    await runTest('Inherited about frames fail closed under a disabled site rule', async () => {
      await setStorage({
        enabled: true,
        siteRules: [{ pattern: 'tests/e2e/lifecycle.html', enabled: false, speed: null }],
      });
      await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
      await sleep(3000);

      const state = await page.evaluate(() => {
        const inspect = (selector) => {
          const frame = document.querySelector(selector);
          return !!frame?.contentWindow?.VSC_controller?.initialized;
        };
        return {
          top: !!window.VSC_controller?.initialized,
          blank: inspect('#blank-frame'),
          uppercaseBlank: inspect('#uppercase-blank-frame'),
          srcdoc: inspect('#srcdoc-frame'),
        };
      });

      if (state.top || state.blank || state.uppercaseBlank || state.srcdoc) {
        throw new Error(`Expected every context inactive, got ${JSON.stringify(state)}`);
      }
    });

    await runTest('Disable cancels queued startup and re-enable waits for reload', async () => {
      await setStorage({ enabled: true, siteRules: [] });
      await page.goto(`${fixtureUrl}?delay=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () =>
          window.__vscIdleCallbacksScheduled > 0 ||
          window.VSC_controller?.config?.settings?._abort === true,
        { timeout: 10000 }
      );
      const startup = await page.evaluate(() => ({
        scheduled: window.__vscIdleCallbacksScheduled,
        initialized: !!window.VSC_controller?.initialized,
        abort: window.VSC_controller?.config?.settings?._abort ?? null,
      }));
      if (!startup.scheduled || startup.abort) {
        throw new Error(`Expected delayed startup, got ${JSON.stringify(startup)}`);
      }

      await setStorage({ enabled: false });
      await sleep(1600);
      const afterDisable = await page.evaluate(() => !!window.VSC_controller?.initialized);
      if (afterDisable) {
        throw new Error('Queued startup resurrected VSC after disable');
      }

      await setStorage({ enabled: true });
      await sleep(500);
      const afterEnable = await page.evaluate(() => !!window.VSC_controller?.initialized);
      if (afterEnable) {
        throw new Error('VSC re-enabled without the reload promised by the popup');
      }

      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(2500);
      const afterReload = await page.evaluate(() => ({
        scheduled: window.__vscIdleCallbacksScheduled,
        initialized: !!window.VSC_controller?.initialized,
        abort: window.VSC_controller?.config?.settings?._abort ?? null,
      }));
      if (!afterReload.initialized) {
        throw new Error(`VSC did not initialize after reload: ${JSON.stringify(afterReload)}`);
      }
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 Lifecycle E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
