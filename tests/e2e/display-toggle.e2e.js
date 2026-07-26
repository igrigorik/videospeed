/**
 * E2E coverage for the V-key visibility override and automatic autohide.
 */

import { launchChromeWithExtension, waitForController } from './e2e-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getControllerState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('vsc-controller');
    const controller = host?.shadowRoot?.querySelector('#controller');
    const hostStyle = host ? getComputedStyle(host) : null;
    const style = controller ? getComputedStyle(controller) : null;

    return {
      found: !!controller,
      mode: host?.dataset.vscVisibility || 'auto',
      automaticHidden: !!host?.classList.contains('vsc-hidden'),
      flashing: !!host?.classList.contains('vsc-show'),
      visible:
        !!hostStyle &&
        !!style &&
        hostStyle.display !== 'none' &&
        hostStyle.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.visibility !== 'hidden',
    };
  });
}

function assertState(state, expected, context) {
  if (!state.found) {
    throw new Error(`${context}: controller disappeared`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (state[key] !== value) {
      throw new Error(`${context}: expected ${key}=${value}, got ${JSON.stringify(state)}`);
    }
  }
}

async function waitForState(page, expected, context) {
  await page.waitForFunction(
    (target) => {
      const host = document.querySelector('vsc-controller');
      const controller = host?.shadowRoot?.querySelector('#controller');
      if (!controller) {
        return false;
      }
      const hostStyle = getComputedStyle(host);
      const style = getComputedStyle(controller);
      const current = {
        mode: host.dataset.vscVisibility || 'auto',
        automaticHidden: host.classList.contains('vsc-hidden'),
        flashing: host.classList.contains('vsc-show'),
        visible:
          hostStyle.display !== 'none' &&
          hostStyle.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.visibility !== 'hidden',
      };
      return Object.entries(target).every(([key, value]) => current[key] === value);
    },
    { timeout: 2000, polling: 50 },
    expected
  );

  assertState(await getControllerState(page), expected, context);
}

async function assertCssVisibilityMatrix(page) {
  const result = await page.evaluate(() => {
    const host = document.querySelector('vsc-controller');
    const controller = host?.shadowRoot?.querySelector('#controller');
    if (!host || !controller) {
      return { count: 0, failures: ['controller unavailable'] };
    }

    // Transitions make visibility temporarily report the previous state. This
    // test sheet changes timing only; the production selector cascade remains
    // the object under test.
    const noTransitions = new CSSStyleSheet();
    noTransitions.replaceSync('#controller { transition: none !important; }');
    host.shadowRoot.adoptedStyleSheets = [...host.shadowRoot.adoptedStyleSheets, noTransitions];

    const modes = ['auto', 'show', 'hide'];
    const booleans = [false, true];
    const failures = [];
    let count = 0;

    for (const mode of modes) {
      for (const automaticHidden of booleans) {
        for (const siteAutohide of booleans) {
          for (const flash of booleans) {
            for (const noSource of booleans) {
              for (const hostHidden of booleans) {
                if (mode === 'auto') {
                  delete host.dataset.vscVisibility;
                } else {
                  host.dataset.vscVisibility = mode;
                }
                host.classList.toggle('vsc-hidden', automaticHidden);
                host.classList.toggle('vsc-show', flash);
                host.classList.toggle('vsc-nosource', noSource);
                document.body.classList.toggle('ytp-autohide', siteAutohide);
                host.style.display = hostHidden ? 'none' : '';

                const hostStyle = getComputedStyle(host);
                const controllerStyle = getComputedStyle(controller);
                const actual =
                  hostStyle.display !== 'none' &&
                  hostStyle.visibility !== 'hidden' &&
                  controllerStyle.display !== 'none' &&
                  controllerStyle.visibility !== 'hidden';
                const hardHidden = hostHidden || noSource || mode === 'hide';
                const forcedShown = mode === 'show' || flash;
                const expected =
                  !hardHidden && (forcedShown || (!automaticHidden && !siteAutohide));
                count += 1;

                if (actual !== expected) {
                  failures.push({
                    mode,
                    automaticHidden,
                    siteAutohide,
                    flash,
                    noSource,
                    hostHidden,
                    expected,
                    actual,
                    hostDisplay: hostStyle.display,
                    display: controllerStyle.display,
                    visibility: controllerStyle.visibility,
                  });
                }
              }
            }
          }
        }
      }
    }

    delete host.dataset.vscVisibility;
    host.classList.remove('vsc-hidden', 'vsc-show', 'vsc-nosource');
    document.body.classList.remove('ytp-autohide');
    host.style.display = '';
    host.shadowRoot.adoptedStyleSheets = host.shadowRoot.adoptedStyleSheets.filter(
      (sheet) => sheet !== noTransitions
    );
    return { count, failures };
  });

  if (result.count !== 96 || result.failures.length > 0) {
    throw new Error(`CSS visibility matrix failed: ${JSON.stringify(result)}`);
  }
  console.log('   ✅ CSS precedence matrix: 96/96 states');
}

async function getDualControllerStates(page) {
  return page.evaluate(() => {
    const read = (id) => {
      const media = document.getElementById(id);
      const host = media?.vsc?.div;
      const controller = host?.shadowRoot?.querySelector('#controller');
      if (!host || !controller) {
        return { attached: false };
      }
      const hostStyle = getComputedStyle(host);
      const style = getComputedStyle(controller);
      return {
        attached: host.isConnected,
        mode: host.dataset.vscVisibility || 'auto',
        automaticHidden: host.classList.contains('vsc-hidden'),
        flashing: host.classList.contains('vsc-show'),
        visible:
          hostStyle.display !== 'none' &&
          hostStyle.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.visibility !== 'hidden',
      };
    };
    return { video1: read('videoA'), video2: read('videoB') };
  });
}

async function waitForDualControllerStates(page, expected, context) {
  await page.waitForFunction(
    (target) => {
      const read = (id) => {
        const media = document.getElementById(id);
        const host = media?.vsc?.div;
        const controller = host?.shadowRoot?.querySelector('#controller');
        if (!host || !controller) {
          return { attached: false };
        }
        const hostStyle = getComputedStyle(host);
        const style = getComputedStyle(controller);
        return {
          attached: host.isConnected,
          mode: host.dataset.vscVisibility || 'auto',
          automaticHidden: host.classList.contains('vsc-hidden'),
          visible:
            hostStyle.display !== 'none' &&
            hostStyle.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.visibility !== 'hidden',
        };
      };
      const fixtureIds = { video1: 'videoA', video2: 'videoB' };
      return Object.entries(target).every(([id, fields]) => {
        const current = read(fixtureIds[id]);
        return Object.entries(fields).every(([key, value]) => current[key] === value);
      });
    },
    { timeout: 2000, polling: 50 },
    expected
  );

  const actual = await getDualControllerStates(page);
  for (const [id, fields] of Object.entries(expected)) {
    for (const [key, value] of Object.entries(fields)) {
      if (actual[id]?.[key] !== value) {
        throw new Error(
          `${context}: expected ${id}.${key}=${value}, got ${JSON.stringify(actual)}`
        );
      }
    }
  }
}

async function testDisplayToggle() {
  console.log('🧪 Testing display visibility overrides...');

  const { browser, page } = await launchChromeWithExtension();

  try {
    const testPagePath = `file://${path.join(__dirname, 'test-video.html')}`;
    await page.goto(testPagePath, { waitUntil: 'networkidle2' });

    const found = await waitForController(page, 15000);
    if (!found) {
      throw new Error('Controller never appeared');
    }

    await waitForState(
      page,
      { mode: 'auto', automaticHidden: false, visible: true },
      'initial automatic state'
    );
    await assertCssVisibilityMatrix(page);
    await waitForState(
      page,
      { mode: 'auto', automaticHidden: false, flashing: false, visible: true },
      'matrix cleanup'
    );

    // AUTO + visible -> FORCE_HIDE.
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'hide', automaticHidden: false, visible: false },
      'first V press while automatically visible'
    );

    // The next press clears the override instead of creating sticky state.
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'auto', automaticHidden: false, visible: true },
      'second V press returning to automatic visibility'
    );

    // FORCE_SHOW overrides the automatic class used by startHidden and media visibility.
    await page.evaluate(() => document.querySelector('vsc-controller').classList.add('vsc-hidden'));
    await waitForState(
      page,
      { mode: 'auto', automaticHidden: true, visible: false },
      'automatic hidden class'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'show', automaticHidden: true, visible: true },
      'show override beats automatic hidden class'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'auto', automaticHidden: true, visible: false },
      'show override clears back to automatic hidden'
    );
    await page.evaluate(() =>
      document.querySelector('vsc-controller').classList.remove('vsc-hidden')
    );
    await waitForState(
      page,
      { mode: 'auto', automaticHidden: false, visible: true },
      'automatic hidden class cleared'
    );

    // Use the same ancestor contract as YouTube without relying on a live site.
    await page.evaluate(() => document.body.classList.add('ytp-autohide'));
    await waitForState(page, { mode: 'auto', visible: false }, 'automatic site autohide');

    // AUTO + hidden -> FORCE_SHOW, which must outrank site autohide.
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'show', automaticHidden: false, visible: true },
      'V press while automatically hidden'
    );

    // A controller without usable media stays hidden even under FORCE_SHOW.
    await page.evaluate(() =>
      document.querySelector('vsc-controller').classList.add('vsc-nosource')
    );
    await waitForState(
      page,
      { mode: 'show', visible: false },
      'no-source state beats show override'
    );
    await page.evaluate(() =>
      document.querySelector('vsc-controller').classList.remove('vsc-nosource')
    );
    await waitForState(page, { mode: 'show', visible: true }, 'show resumes when media is usable');

    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'auto', visible: false },
      'show override cleared back to autohide'
    );

    // Temporary speed feedback wins over autohide, but V must still flip the
    // currently rendered state instead of pinning the flash visible.
    await page.evaluate(() => document.querySelector('vsc-controller').classList.add('vsc-show'));
    await waitForState(
      page,
      { mode: 'auto', flashing: true, visible: true },
      'flash overrides autohide'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'hide', flashing: false, visible: false },
      'V hides a controller currently visible from flash'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'auto', flashing: false, visible: false },
      'flash hide override clears back to autohide'
    );

    await page.evaluate(() => document.body.classList.remove('ytp-autohide'));
    await waitForState(
      page,
      { mode: 'auto', visible: true },
      'automatic visibility restored with site controls'
    );

    // Force-hide is final even if a stale flash class is present.
    await page.keyboard.press('v');
    await waitForState(page, { mode: 'hide', visible: false }, 'explicit hide override');
    await page.evaluate(() => document.querySelector('vsc-controller').classList.add('vsc-show'));
    await waitForState(page, { mode: 'hide', visible: false }, 'hide override beats flash');
    await page.evaluate(() =>
      document.querySelector('vsc-controller').classList.remove('vsc-show')
    );
    await page.keyboard.press('v');
    await waitForState(page, { mode: 'auto', visible: true }, 'hide override cleared to auto');

    // Broadcast actions must sample and transition each controller independently.
    const dualVideoPath = `file://${path.join(__dirname, 'dual-video.html')}`;
    await page.goto(dualVideoPath, { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => ['videoA', 'videoB'].every((id) => document.getElementById(id)?.vsc?.div?.shadowRoot),
      { timeout: 15000, polling: 100 }
    );
    await page.evaluate(() => {
      const first = document.getElementById('videoA').vsc.div;
      const second = document.getElementById('videoB').vsc.div;
      for (const host of [first, second]) {
        delete host.dataset.vscVisibility;
        host.classList.remove('vsc-hidden', 'vsc-show', 'vsc-nosource');
      }
      first.classList.add('vsc-hidden', 'vsc-show');
      second.classList.add('vsc-hidden');
    });
    await waitForDualControllerStates(
      page,
      {
        video1: { mode: 'auto', automaticHidden: true, visible: true },
        video2: { mode: 'auto', automaticHidden: true, visible: false },
      },
      'mixed pre-broadcast visibility'
    );

    await page.keyboard.press('v');
    await waitForDualControllerStates(
      page,
      {
        video1: { mode: 'hide', automaticHidden: true, visible: false },
        video2: { mode: 'show', automaticHidden: true, visible: true },
      },
      'broadcast independently flips rendered state'
    );
    await page.keyboard.press('v');
    await waitForDualControllerStates(
      page,
      {
        video1: { mode: 'auto', automaticHidden: true, visible: false },
        video2: { mode: 'auto', automaticHidden: true, visible: false },
      },
      'broadcast independently clears overrides'
    );

    // A targeted adapter action must not rewrite the other controller.
    await page.evaluate(() => {
      document.getElementById('videoA').vsc.div.classList.remove('vsc-hidden');
    });
    await waitForDualControllerStates(
      page,
      {
        video1: { mode: 'auto', automaticHidden: false, visible: true },
        video2: { mode: 'auto', automaticHidden: true, visible: false },
      },
      'targeted-action setup'
    );
    await page.evaluate(() => {
      const media = document.getElementById('videoA');
      media.vsc.actionHandler.executeAction('display', 0, media, null);
    });
    await waitForDualControllerStates(
      page,
      {
        video1: { mode: 'hide', visible: false },
        video2: { mode: 'auto', visible: false },
      },
      'targeted action changes one controller'
    );
    await page.evaluate(() => {
      const media = document.getElementById('videoA');
      media.vsc.actionHandler.executeAction('display', 0, media, null);
    });
    await waitForDualControllerStates(
      page,
      {
        video1: { mode: 'auto', visible: true },
        video2: { mode: 'auto', visible: false },
      },
      'targeted action clears one override'
    );

    // A released controller is no longer part of document-wide broadcasts.
    await page.evaluate(() => {
      const media = document.getElementById('videoA');
      window.__releasedVisibilityHost = media.vsc.div;
      media.vsc.remove();
    });
    await page.keyboard.press('v');
    await waitForDualControllerStates(
      page,
      {
        video1: { attached: false },
        video2: { mode: 'show', automaticHidden: true, visible: true },
      },
      'broadcast ignores released controller'
    );
    const releasedHostDetached = await page.evaluate(
      () => !window.__releasedVisibilityHost?.isConnected
    );
    if (!releasedHostDetached) {
      throw new Error('released controller host remained connected');
    }

    console.log('   ✅ Mixed-controller local/broadcast/release transitions');
    console.log('✅ Display visibility override test passed!');
    return { success: true };
  } catch (error) {
    console.error('❌ Display visibility override test failed:', error.message);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function run() {
  const result = await testDisplayToggle();
  return {
    passed: result.success ? 1 : 0,
    failed: result.success ? 0 : 1,
  };
}

export { testDisplayToggle };
