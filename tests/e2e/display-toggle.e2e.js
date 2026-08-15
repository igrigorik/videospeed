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

async function getControlsExpansionState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('vsc-controller');
    const controller = host?.shadowRoot?.querySelector('#controller');
    const controls = host?.shadowRoot?.querySelector('#controls');
    const draggable = host?.shadowRoot?.querySelector('.draggable');
    return {
      found: !!controller && !!controls && !!draggable,
      expanded: !!controller?.classList.contains('vsc-expanded'),
      controlsVisible: controls ? getComputedStyle(controls).display !== 'none' : false,
      indicatorMarginRight: draggable ? parseFloat(getComputedStyle(draggable).marginRight) : 0,
    };
  });
}

async function waitForControlsExpansion(page, expected, context) {
  await page.waitForFunction(
    (expanded) => {
      const host = document.querySelector('vsc-controller');
      const controller = host?.shadowRoot?.querySelector('#controller');
      const controls = host?.shadowRoot?.querySelector('#controls');
      if (!controller || !controls) {
        return false;
      }
      return (
        controller.classList.contains('vsc-expanded') === expanded &&
        (getComputedStyle(controls).display !== 'none') === expanded
      );
    },
    { timeout: 2000, polling: 50 },
    expected
  );

  const state = await getControlsExpansionState(page);
  if (
    !state.found ||
    state.expanded !== expected ||
    state.controlsVisible !== expected ||
    (expected && state.indicatorMarginRight <= 0)
  ) {
    throw new Error(`${context}: unexpected expansion state ${JSON.stringify(state)}`);
  }
}

async function installControllerCSSForDomain(page, hostname) {
  const autohideRuleLoaded = await page.evaluate((domain) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      window.VSC_controller.preprocessDomainCSS(window.VSC.Constants.DEFAULT_CONTROLLER_CSS, domain)
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    window.__vscDomainControllerSheet = sheet;
    return Array.from(sheet.cssRules).some(
      (rule) =>
        rule.cssText.includes('.ytp-autohide') &&
        rule.cssText.includes('[data-vsc-visibility="show"]') &&
        rule.cssText.includes('.vsc-show')
    );
  }, hostname);

  if (!autohideRuleLoaded) {
    throw new Error(`Failed to load production autohide CSS for ${hostname}`);
  }
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

    // Keep the pointer outside the controller so computed display reflects the
    // preference rather than the existing hover behavior.
    await page.mouse.move(1200, 700);
    await waitForControlsExpansion(page, false, 'controls collapsed by default');

    await page.evaluate(() => {
      document.documentElement.dispatchEvent(
        new CustomEvent('VSC_STORAGE_CHANGED', {
          detail: { keepControlsExpanded: { oldValue: false, newValue: true } },
        })
      );
    });
    await waitForControlsExpansion(page, true, 'live preference enables expanded controls');

    await page.evaluate(() => {
      document
        .querySelector('vsc-controller')
        ?.shadowRoot?.querySelector('button[data-action="advance"]')
        ?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await waitForControlsExpansion(page, true, 'expanded controls remain after use and timeout');

    await page.evaluate(() => {
      document.documentElement.dispatchEvent(
        new CustomEvent('VSC_STORAGE_CHANGED', {
          detail: { keepControlsExpanded: { oldValue: true, newValue: false } },
        })
      );
    });
    await waitForControlsExpansion(page, false, 'live preference restores hover behavior');
    console.log('   ✅ Live controls expansion preference');

    // The fixture is file://, so install the actual production defaults after
    // resolving their domain markers as YouTube. This keeps the matrix on the
    // shipped light-DOM selector instead of a test-only approximation.
    await installControllerCSSForDomain(page, 'youtube.com');

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

    // First V opposes rendered AUTO; later presses alternate persistent intent.
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'hide', automaticHidden: false, visible: false },
      'first V press while automatically visible'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'show', automaticHidden: false, visible: true },
      'second V press selects persistent show'
    );

    // Regression for #1584: YouTube autohide must not retake control after
    // the visible AUTO -> HIDE -> SHOW sequence.
    await page.evaluate(() => document.body.classList.add('ytp-autohide'));
    await waitForState(
      page,
      { mode: 'show', automaticHidden: false, visible: true },
      'persistent show survives site autohide'
    );
    await page.keyboard.press('v');
    await waitForState(page, { mode: 'hide', visible: false }, 'show alternates to hide');
    await page.keyboard.press('v');
    await waitForState(page, { mode: 'show', visible: true }, 'hide alternates back to show');

    // A controller without usable media stays hidden even under FORCE_SHOW,
    // then resumes the same explicit intent when media becomes usable.
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

    // Reset to untouched AUTO to exercise first-toggle sampling under flash.
    await page.evaluate(() => {
      const host = document.querySelector('vsc-controller');
      delete host.dataset.vscVisibility;
      host.classList.add('vsc-show');
    });
    await waitForState(
      page,
      { mode: 'auto', flashing: true, visible: true },
      'flash overrides autohide'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'hide', flashing: false, visible: false },
      'V samples flash before selecting hide'
    );
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'show', flashing: false, visible: true },
      'hide alternates to sticky show under autohide'
    );

    // FORCE_SHOW also overrides the automatic class used by startHidden and
    // media visibility; the automatic layer keeps updating underneath.
    await page.evaluate(() => {
      const video = document.querySelector('video');
      delete video.vsc.div.dataset.vscVisibility;
      document.body.classList.remove('ytp-autohide');
      video.style.visibility = 'hidden';
      video.vsc.updateVisibility();
    });
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
      { mode: 'hide', automaticHidden: true, visible: false },
      'show alternates to persistent hide'
    );

    // Explicit hide is final even if a stale flash class is present.
    await page.evaluate(() => document.querySelector('vsc-controller').classList.add('vsc-show'));
    await waitForState(page, { mode: 'hide', visible: false }, 'hide override beats flash');
    await page.keyboard.press('v');
    await waitForState(
      page,
      { mode: 'show', flashing: false, visible: true },
      'hide alternates to show and clears stale flash'
    );

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
        video1: { mode: 'show', automaticHidden: true, visible: true },
        video2: { mode: 'hide', automaticHidden: true, visible: false },
      },
      'broadcast independently alternates persistent intent'
    );

    // A targeted adapter action must not rewrite the other controller. Reset
    // both hosts to untouched AUTO so only the targeted controller leaves it.
    await page.evaluate(() => {
      const first = document.getElementById('videoA').vsc.div;
      const second = document.getElementById('videoB').vsc.div;
      delete first.dataset.vscVisibility;
      delete second.dataset.vscVisibility;
      first.classList.remove('vsc-hidden', 'vsc-show');
      second.classList.add('vsc-hidden');
      second.classList.remove('vsc-show');
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
        video1: { mode: 'show', visible: true },
        video2: { mode: 'auto', visible: false },
      },
      'targeted action alternates one controller to show'
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
