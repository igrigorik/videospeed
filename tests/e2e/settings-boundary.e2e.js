/**
 * Browser-level coverage for the settings trust boundary
 * (docs/settings-trust-boundary.md): what a page can learn about the user's
 * settings, and what it can make the extension store.
 *
 * Runs the built extension. A listener installed before any page or extension
 * script records every bridge event the page can see, so these tests read what
 * a hostile page would read, not what the page script chooses to keep.
 */

import { assert, launchChromeWithExtension, sleep } from './e2e-utils.js';

const BRIDGE_EVENTS = ['VSC_SETTINGS_READY', 'VSC_STORAGE_CHANGED', 'VSC_MESSAGE'];

const RUNTIME_SETTINGS_KEYS = [
  'initialSpeed',
  'rememberSpeed',
  'exclusiveKeys',
  'audioBoolean',
  'startHidden',
  'controllerOpacity',
  'controllerButtonSize',
  'customCSS',
  'keyBindings',
  'logLevel',
];

/** Record bridge events from the first moment of every document in `page`. */
async function recordBridgeEvents(page) {
  await page.evaluateOnNewDocument((types) => {
    window.__bridgeEvents = [];
    for (const type of types) {
      // Capture on window: documentElement does not exist yet.
      window.addEventListener(
        type,
        (event) => {
          window.__bridgeEvents.push({
            type,
            detail: JSON.parse(JSON.stringify(event.detail ?? null)),
          });
        },
        true
      );
    }
  }, BRIDGE_EVENTS);
}

const bridgeEvents = (page) => page.evaluate(() => window.__bridgeEvents);

const waitForBridgeEvent = (page, type) =>
  page.waitForFunction(
    (wanted) => window.__bridgeEvents.some((event) => event.type === wanted),
    { timeout: 10000 },
    type
  );

const assertSame = (actual, expected, message) =>
  assert.equal(
    JSON.stringify(actual),
    JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

export default async function runSettingsBoundaryE2ETests() {
  console.log('🔐 Running Settings Boundary E2E Tests...');

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
    await recordBridgeEvents(page);

    const worker = await browser.waitForTarget((target) => target.type() === 'service_worker', {
      timeout: 15000,
    });
    const extensionId = new URL(worker.url()).host;
    const optionsUrl = `chrome-extension://${extensionId}/ui/options/options.html`;
    const optionsPage = await browser.newPage();
    await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });

    /** Replace sync storage with exactly `settings`, as a profile would hold it. */
    const store = (settings) =>
      optionsPage.evaluate(async (values) => {
        await new Promise((resolve) => chrome.storage.sync.clear(resolve));
        await new Promise((resolve) => chrome.storage.sync.set(values, resolve));
      }, settings);
    const update = (settings) =>
      optionsPage.evaluate(
        (values) => new Promise((resolve) => chrome.storage.sync.set(values, resolve)),
        settings
      );
    const stored = () =>
      optionsPage.evaluate(() => new Promise((resolve) => chrome.storage.sync.get(null, resolve)));

    const fixtureUrl = `file://${process.cwd()}/tests/e2e/test-video.html`;
    const fixtureRule = (overrides) => ({
      pattern: 'tests/e2e/test-video.html',
      enabled: true,
      speed: null,
      ...overrides,
    });

    /** Load the fixture and return the handshake answer the page could read. */
    const visitFixture = async () => {
      await page.bringToFront();
      await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
      await waitForBridgeEvent(page, 'VSC_SETTINGS_READY');
      const answers = (await bridgeEvents(page)).filter(
        (event) => event.type === 'VSC_SETTINGS_READY'
      );
      assert.equal(answers.length, 1, `Expected one handshake answer, got ${answers.length}`);
      return answers[0].detail;
    };

    const visibleSettings = { rememberSpeed: false, customCSS: 'vsc-controller { opacity: 0.9; }' };
    let firstAnswer;

    await runTest('A page is told one initial speed and the runtime preferences', async () => {
      await store({
        ...visibleSettings,
        lastSpeed: 1.5,
        blacklist: 'private-legacy.example',
        siteRules: [
          { pattern: 'private-health.example', enabled: false, speed: null },
          fixtureRule({ speed: 2 }),
        ],
      });

      firstAnswer = await visitFixture();

      assertSame(Object.keys(firstAnswer), ['settings'], 'Handshake detail keys');
      assertSame(Object.keys(firstAnswer.settings), RUNTIME_SETTINGS_KEYS, 'Runtime settings keys');
      assert.equal(firstAnswer.settings.initialSpeed, 2, 'Site rule speed should be resolved');
      assert.equal(firstAnswer.settings.customCSS, visibleSettings.customCSS);

      const seen = JSON.stringify(await bridgeEvents(page));
      assert.false(seen.includes('private'), `Bridge events leaked private settings: ${seen}`);
    });

    await runTest('The page script holds runtime settings only', async () => {
      await page.waitForFunction(() => window.VSC_controller?.config?.settings?.lastSpeed === 2, {
        timeout: 10000,
      });
      const held = await page.evaluate(() => ({
        keys: Object.keys(window.VSC_controller.config.settings).sort(),
        dump: JSON.stringify(window.VSC_controller.config.settings),
        cache: typeof window.VSC_settings,
        matcher: typeof window.VSC.matchSiteRule,
      }));

      const expectedKeys = [
        ...RUNTIME_SETTINGS_KEYS.filter((key) => key !== 'initialSpeed'),
        'lastSpeed',
      ].sort();
      assertSame(held.keys, expectedKeys, 'Settings held by the page script');
      assert.false(held.dump.includes('private'), 'Page script holds private settings');
      assert.equal(held.cache, 'undefined', 'window.VSC_settings should not exist');
      assert.equal(held.matcher, 'undefined', 'The rule matcher should not ship to the page');
    });

    await runTest('Different private settings look the same to the page', async () => {
      await store({
        ...visibleSettings,
        lastSpeed: 3.14159,
        siteRules: [
          { pattern: '/private-bank\\.example/i', enabled: true, speed: 3 },
          fixtureRule({ speed: 2 }),
          fixtureRule({ enabled: false }),
        ],
      });

      assertSame(await visitFixture(), firstAnswer, 'Handshake answer');
    });

    await runTest(
      'Rule edits are not relayed; a preference change carries its new value',
      async () => {
        await update({
          lastSpeed: 1.25,
          siteRules: [{ pattern: 'private-edit.example', enabled: false, speed: null }],
        });
        await sleep(500);
        const afterPrivateEdit = (await bridgeEvents(page)).filter(
          (event) => event.type === 'VSC_STORAGE_CHANGED'
        );
        assertSame(afterPrivateEdit, [], 'Relayed changes after a private edit');

        await update({ startHidden: true });
        await waitForBridgeEvent(page, 'VSC_STORAGE_CHANGED');
        const relayed = (await bridgeEvents(page)).filter(
          (event) => event.type === 'VSC_STORAGE_CHANGED'
        );
        assertSame(
          relayed.map((event) => event.detail),
          [{ startHidden: { newValue: true } }],
          'Relay'
        );
      }
    );

    await runTest('A popup command reaches the page rebuilt from its known fields', async () => {
      // Sent from an extension page, as the popup would send it.
      await optionsPage.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        const send = (message) =>
          Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
        await send({ type: 'VSC_EXPORT_SETTINGS', payload: { note: 'private' } });
        await send({
          type: 'VSC_TOGGLE_DISPLAY',
          payload: { note: 'private' },
          settings: { siteRules: ['private.example'] },
        });
      });
      await waitForBridgeEvent(page, 'VSC_MESSAGE');

      const commands = (await bridgeEvents(page)).filter((event) => event.type === 'VSC_MESSAGE');
      assertSame(
        commands.map((event) => event.detail),
        [{ type: 'VSC_TOGGLE_DISPLAY' }],
        'Commands seen by the page'
      );
    });

    await runTest('A page cannot have a speed remembered unless the user asked', async () => {
      const ask = (lastSpeed) =>
        page.evaluate((speed) => {
          document.documentElement.dispatchEvent(
            new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: speed } })
          );
        }, lastSpeed);

      await ask(1.234567891234567);
      await sleep(500);
      assert.equal((await stored()).lastSpeed, 1.25, 'A write got through with remembering off');

      await update({ rememberSpeed: true });
      await page.waitForFunction(
        () => window.__bridgeEvents.some((event) => event.detail?.rememberSpeed?.newValue === true),
        { timeout: 10000 }
      );
      await ask(1.234567891234567);
      await sleep(500);
      assert.equal((await stored()).lastSpeed, 1.23, 'A remembered speed keeps two decimals');
    });

    await runTest('A site the user disabled learns only that VSC is off', async () => {
      await store({ ...visibleSettings, siteRules: [fixtureRule({ enabled: false })] });

      assertSame(await visitFixture(), { abort: true }, 'Handshake answer');
      assertSame(
        await bridgeEvents(page),
        [{ type: 'VSC_SETTINGS_READY', detail: { abort: true } }],
        'Bridge events'
      );
    });

    await runTest('Default-disabled sites stay off on a profile that never saved', async () => {
      // Serve imgur.com from memory so the default rule is exercised offline.
      const sitePage = await browser.newPage();
      await recordBridgeEvents(sitePage);
      await sitePage.setRequestInterception(true);
      sitePage.on('request', (request) =>
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>stub</title><video></video>',
        })
      );

      try {
        await store({});
        await sitePage.goto('https://imgur.com/gallery/abc', { waitUntil: 'domcontentloaded' });
        await waitForBridgeEvent(sitePage, 'VSC_SETTINGS_READY');
        assertSame(
          await bridgeEvents(sitePage),
          [{ type: 'VSC_SETTINGS_READY', detail: { abort: true } }],
          'Bridge events on imgur.com with nothing saved'
        );

        await store({ siteRules: [] });
        await sitePage.goto('https://imgur.com/gallery/abc', { waitUntil: 'domcontentloaded' });
        await waitForBridgeEvent(sitePage, 'VSC_SETTINGS_READY');
        const [answer] = await bridgeEvents(sitePage);
        assert.exists(answer.detail.settings, 'VSC should run once the user saved an empty list');
      } finally {
        await sitePage.close();
      }
    });

    await runTest('The options page shows a legacy blacklist as the rules in force', async () => {
      await store({ blacklist: 'legacy-one.example\nlegacy-two.example' });
      await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
      await optionsPage.waitForSelector('.row.site-rule');

      const shown = await optionsPage.evaluate(() =>
        Array.from(document.querySelectorAll('.row.site-rule')).map((row) => ({
          pattern: row.querySelector('.rulePattern').value,
          disabled: row.querySelector('.ruleDisabled').checked,
        }))
      );
      assertSame(
        shown,
        [
          { pattern: 'legacy-one.example', disabled: true },
          { pattern: 'legacy-two.example', disabled: true },
        ],
        'Rules shown'
      );
      assertSame(Object.keys(await stored()), ['blacklist'], 'Keys stored after viewing options');
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 Settings Boundary E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
