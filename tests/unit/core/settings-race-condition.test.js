/**
 * Tests for cross-context settings behavior.
 *
 * Covers: granular writes (only changed keys hit storage), debounce
 * correctness, cross-context race windows, onChanged listener freshness
 * for non-authority keys, and lastSpeed session isolation (#1559): the
 * listener NEVER adopts remote lastSpeed — session authority is
 * tab-local, storage is last-writer-wins and consulted only at load().
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
  simulateExternalStorageWrite,
} from '../../helpers/chrome-mock.js';
import { vi } from 'vitest';

// These tests run with chrome.storage mock installed (extension context),
// simulating options page / popup behavior where all settings keys are
// readable and writable via chrome.storage.sync.
describe('SettingsRaceCondition', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  // ===========================================================================
  // SECTION 1: Granular write correctness
  // ===========================================================================

  it('save() writes ONLY the changed keys, not the full blob', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Capture what gets written to storage
    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    // Save ONLY startHidden
    await config.save({ startHidden: true });

    expect(mockSet).toHaveBeenCalledOnce();
    const written = mockSet.mock.calls[0][0];
    const writtenKeys = Object.keys(written);

    // The payload should contain ONLY startHidden — not lastSpeed, not keyBindings, etc.
    expect(writtenKeys.length).toBe(1);
    expect(writtenKeys[0]).toBe('startHidden');
    expect(written.startHidden).toBe(true);

    window.VSC.StorageManager.set = originalSet;
  });

  it('save() with multiple keys writes only those keys', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    await config.save({ startHidden: true, controllerOpacity: 0.8 });

    expect(mockSet).toHaveBeenCalledOnce();
    const writtenKeys = Object.keys(mockSet.mock.calls[0][0]).sort();
    expect(writtenKeys).toEqual(['controllerOpacity', 'startHidden']);

    window.VSC.StorageManager.set = originalSet;
  });

  it('debounced lastSpeed save writes ONLY lastSpeed', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Wait generously for any pending async from load() and prior tests
    await vi.advanceTimersByTimeAsync(1200);

    // Set up spy AFTER all prior async is drained
    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    // Trigger debounced save
    await config.save({ lastSpeed: 2.5 });

    // Nothing written yet (debounced)
    expect(mockSet).not.toHaveBeenCalled();

    // Wait for debounce to fire
    await vi.advanceTimersByTimeAsync(1200);

    expect(mockSet).toHaveBeenCalledOnce();
    const written = mockSet.mock.calls[0][0];
    const writtenKeys = Object.keys(written);
    expect(writtenKeys.length).toBe(1);
    expect(writtenKeys[0]).toBe('lastSpeed');
    expect(written.lastSpeed).toBe(2.5);

    window.VSC.StorageManager.set = originalSet;
  });

  // ===========================================================================
  // SECTION 2: Race window reproduction — these FAIL on the old code
  // ===========================================================================

  it('Race 1: options page save does NOT clobber speed from another context', async () => {
    // Simulate: content script set speed to 2.0, then options page saves startHidden
    const storage = getMockStorage();

    // T=0: config loads (lastSpeed=null, no user choice yet)
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBeNull();

    // T=1: "another context" changes speed to 2.0 in storage
    // (simulated by direct storage write)
    storage.lastSpeed = 2.0;

    // T=2: this config saves startHidden=true (simulating options page)
    await config.save({ startHidden: true });

    // Wait for any async storage operations
    await vi.advanceTimersByTimeAsync(50);

    // CRITICAL: storage.lastSpeed should STILL be 2.0
    // Old code would write {...this.settings} which has stale lastSpeed=1.0
    expect(storage.lastSpeed).toBe(2.0);
  });

  it('Race 2: debounce timer does NOT write stale non-speed fields', async () => {
    const storage = getMockStorage();

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // T=0: config initiates debounced speed save
    await config.save({ lastSpeed: 1.5 });

    // T=0.5: another context changes startHidden in storage
    storage.startHidden = true;

    // T=1: debounce fires — should write ONLY {lastSpeed: 1.5}, NOT {startHidden: false}
    await vi.advanceTimersByTimeAsync(1100);

    expect(storage.startHidden).toBe(true);
    expect(storage.lastSpeed).toBe(1.5);
  });

  it('Race 3: two config instances writing different keys dont clobber each other', async () => {
    const storage = getMockStorage();

    // Two independent config instances (simulates two tabs)
    const configA = new window.VSC.VideoSpeedConfig();
    await configA.load();

    const configB = new window.VSC.VideoSpeedConfig();
    await configB.load();

    // Config A saves controllerOpacity
    await configA.save({ controllerOpacity: 0.9 });

    // Config B saves startHidden
    await configB.save({ startHidden: true });

    await vi.advanceTimersByTimeAsync(50);

    // BOTH should be preserved in storage
    expect(storage.controllerOpacity).toBe(0.9);
    expect(storage.startHidden).toBe(true);
  });

  it('Race 4: rapid save of different keys preserves all', async () => {
    const storage = getMockStorage();

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Rapid sequence of saves — each should write only its own key
    await config.save({ startHidden: true });
    await config.save({ controllerOpacity: 0.7 });
    await config.save({ audioBoolean: true });

    await vi.advanceTimersByTimeAsync(50);

    expect(storage.startHidden).toBe(true);
    expect(storage.controllerOpacity).toBe(0.7);
    expect(storage.audioBoolean).toBe(true);
    // Speed should be untouched (still default)
    expect(storage.lastSpeed).toBe(1.0);
  });

  it('Race 5: options page full settings save does not revert speed', async () => {
    const storage = getMockStorage();

    // Simulate content script has set speed to 3.0
    storage.lastSpeed = 3.0;

    // Options page loads (gets lastSpeed=3.0 at load time)
    const optionsConfig = new window.VSC.VideoSpeedConfig();
    await optionsConfig.load();

    // Meanwhile, user changes speed to 4.0 on a content script tab
    storage.lastSpeed = 4.0;

    // Options page saves — this mimics what options.js:275-325 does
    // It builds settingsToSave from form values, which does NOT include lastSpeed
    const settingsFromForm = {
      rememberSpeed: true,
      audioBoolean: true,
      startHidden: false,
      controllerOpacity: 0.5,
      controllerButtonSize: 16,
      logLevel: 4,
      keyBindings: optionsConfig.settings.keyBindings,
      blacklist: 'www.instagram.com',
    };

    await optionsConfig.save(settingsFromForm);
    await vi.advanceTimersByTimeAsync(50);

    // CRITICAL: storage should NOT have reverted lastSpeed from 4.0 to 3.0
    expect(storage.lastSpeed).toBe(4.0);

    // But options settings should be saved
    expect(storage.rememberSpeed).toBe(true);
    expect(storage.controllerOpacity).toBe(0.5);
  });

  // ===========================================================================
  // SECTION 3: onChanged listener — non-authority keys stay fresh,
  // lastSpeed is session-isolated (#1559)
  // ===========================================================================

  it('onChanged listener updates non-authority settings from external writes', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Options-page style change in another context
    simulateExternalStorageWrite({ controllerOpacity: 0.8 });

    // In-memory should be updated via onChanged
    expect(config.settings.controllerOpacity).toBe(0.8);
  });

  it('onChanged listener never adopts remote lastSpeed (session isolation, #1559)', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config.settings.lastSpeed).toBeNull();

    // Another tab's user picks a speed. This tab's session authority —
    // the arbiter's `desired` — must not move: adopting it would mutate
    // arbiter state through a channel outside the event alphabet and is
    // exactly the cross-tab bleed of #1559.
    simulateExternalStorageWrite({ lastSpeed: 3.0 });
    expect(config.settings.lastSpeed).toBeNull();

    // The value still reaches storage: a NEW session (load) picks it up —
    // last-writer-wins at LOAD is the multi-tab contract.
    config.settings.rememberSpeed = true;
    const fresh = new window.VSC.VideoSpeedConfig();
    getMockStorage().rememberSpeed = true;
    await fresh.load();
    expect(fresh.settings.lastSpeed).toBe(3.0);
  });

  it('onChanged listener updates multiple keys at once, still excluding lastSpeed', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    simulateExternalStorageWrite({
      lastSpeed: 2.5,
      startHidden: true,
      controllerOpacity: 0.8,
    });

    expect(config.settings.lastSpeed).toBeNull(); // isolated
    expect(config.settings.startHidden).toBe(true);
    expect(config.settings.controllerOpacity).toBe(0.8);
  });

  it('onChanged listener ignores keys not in settings', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Write a key that doesn't exist in settings — should not crash
    simulateExternalStorageWrite({ unknownKey: 'somevalue' });

    // Existing settings should be unchanged
    expect(config.settings.lastSpeed).toBeNull();
  });

  it('onChanged listener ignores undefined newValue', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    const before = config.settings.controllerOpacity;

    // A removed key arrives as a change with undefined newValue — the real
    // listener must not write undefined into settings.
    simulateExternalStorageWrite({ controllerOpacity: undefined });

    expect(config.settings.controllerOpacity).toBe(before);
  });

  // ===========================================================================
  // SECTION 4: Debounce edge cases with granular writes
  // ===========================================================================

  it('debounced save coalesces correctly with granular writes', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    // Rapid speed changes
    await config.save({ lastSpeed: 1.1 });
    await config.save({ lastSpeed: 1.2 });
    await config.save({ lastSpeed: 1.3 });
    await config.save({ lastSpeed: 1.4 });

    // Nothing written yet
    expect(mockSet).not.toHaveBeenCalled();

    // In-memory should have the latest value
    expect(config.settings.lastSpeed).toBe(1.4);

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(1100);

    // Should write once with final value, and ONLY lastSpeed
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet.mock.calls[0][0]).toEqual({ lastSpeed: 1.4 });

    window.VSC.StorageManager.set = originalSet;
  });

  it('interleaved speed and non-speed saves work correctly', async () => {
    const storage = getMockStorage();
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Speed save (debounced)
    await config.save({ lastSpeed: 2.0 });

    // Non-speed save (immediate) — should NOT carry stale lastSpeed
    await config.save({ startHidden: true });

    await vi.advanceTimersByTimeAsync(50);

    // startHidden should be in storage immediately
    expect(storage.startHidden).toBe(true);

    // Speed not yet written (still debouncing)
    // But once debounce fires...
    await vi.advanceTimersByTimeAsync(1100);

    expect(storage.lastSpeed).toBe(2.0);
    expect(storage.startHidden).toBe(true); // should still be true
  });

  it('debounce timer reset still writes only lastSpeed', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    // First speed save
    await config.save({ lastSpeed: 1.5 });

    // Wait 500ms then another save (resets timer)
    await vi.advanceTimersByTimeAsync(500);
    await config.save({ lastSpeed: 2.0 });

    // Wait 500ms more — first timer would have fired but was reset
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSet).not.toHaveBeenCalled();

    // Wait remaining time
    await vi.advanceTimersByTimeAsync(600);
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet.mock.calls[0][0]).toEqual({ lastSpeed: 2.0 });

    window.VSC.StorageManager.set = originalSet;
  });

  // ===========================================================================
  // SECTION 5: In-memory consistency
  // ===========================================================================

  it('in-memory settings update immediately even before storage write', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Save startHidden — in-memory should update right away
    const savePromise = config.save({ startHidden: true });

    // Check BEFORE await completes
    expect(config.settings.startHidden).toBe(true);

    await savePromise;
  });

  it('in-memory lastSpeed updates immediately during debounce', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    await config.save({ lastSpeed: 3.0 });

    // In-memory should be 3.0 even though storage hasn't been written yet
    expect(config.settings.lastSpeed).toBe(3.0);
  });

  it('save with empty object is a no-op (no storage write)', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    await config.save({});

    // Empty save should short-circuit — no wasted round-trip to storage
    expect(mockSet).not.toHaveBeenCalled();

    window.VSC.StorageManager.set = originalSet;
  });

  // ===========================================================================
  // SECTION 6: Defensive edge cases
  // ===========================================================================

  it('save works correctly when called from load() (keyBindings init)', async () => {
    // Set keyBindings to empty array (triggers first-time init in load())
    const storage = getMockStorage();
    storage.keyBindings = [];

    // Set up spy BEFORE load() since we want to capture the init write
    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Wait for async storage operations to complete
    await vi.advanceTimersByTimeAsync(50);

    // The load() path calls save({keyBindings: ...}) — should write only keyBindings
    expect(mockSet.mock.calls.length >= 1).toBe(true);
    const keyBindingsWrite = mockSet.mock.calls
      .map((call) => Object.keys(call[0]))
      .find((keys) => keys.includes('keyBindings'));
    expect(keyBindingsWrite).toBeDefined();
    expect(keyBindingsWrite.length).toBe(1);

    window.VSC.StorageManager.set = originalSet;
  });

  // ===========================================================================
  // SECTION 7: lastSpeed session isolation under debounce traffic
  // ===========================================================================

  it('own write echo does NOT revert in-memory state', async () => {
    // Timer fires (writes 2.5), user changes to 2.8, the onChanged echo of
    // 2.5 arrives — must NOT revert in-memory from 2.8 back to 2.5. Under
    // session isolation this holds structurally: the listener never
    // touches lastSpeed, so no self-echo token is needed to protect it.
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Start debounce for 2.5
    await config.save({ lastSpeed: 2.5 });

    // Wait for debounce to fire and write
    await vi.advanceTimersByTimeAsync(1200);

    // User immediately changes speed again (new debounce cycle)
    await config.save({ lastSpeed: 2.8 });
    expect(config.settings.lastSpeed).toBe(2.8);

    // The onChanged echo from the 2.5 write fires via mock's setTimeout(5ms).
    // Give it time to arrive.
    await vi.advanceTimersByTimeAsync(50);

    // CRITICAL: in-memory must still be 2.8, NOT reverted to 2.5
    expect(config.settings.lastSpeed).toBe(2.8);

    // The new debounce timer for 2.8 should still be active
    expect(config.saveTimer).toBeDefined();
  });

  it('own write echo does NOT cancel a subsequent debounce timer', async () => {
    const storage = getMockStorage();
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Debounce fires and writes 2.0
    await config.save({ lastSpeed: 2.0 });
    await vi.advanceTimersByTimeAsync(1200);

    // Start new debounce for 3.0
    await config.save({ lastSpeed: 3.0 });

    // Let the echo from the 2.0 write arrive
    await vi.advanceTimersByTimeAsync(50);

    // Timer for 3.0 should still be alive
    expect(config.saveTimer).toBeDefined();

    // Let the 3.0 debounce fire
    await vi.advanceTimersByTimeAsync(1200);

    expect(storage.lastSpeed).toBe(3.0);
  });

  it('remote lastSpeed write neither cancels a pending save nor mutates the session', async () => {
    // Last-writer-wins: this tab's user made a choice; a concurrent write
    // from another tab must not suppress it (the old behavior cancelled
    // our timer and adopted the remote value — shared-authority
    // semantics, retired with #1559 session isolation).
    const storage = getMockStorage();
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Start debounce for 2.0 (this tab's user choice)
    await config.save({ lastSpeed: 2.0 });
    expect(config.saveTimer).toBeDefined();

    // Another tab writes lastSpeed = 3.0
    simulateExternalStorageWrite({ lastSpeed: 3.0 });

    // Our pending save survives, our session authority is untouched
    expect(config.saveTimer).toBeDefined();
    expect(config.settings.lastSpeed).toBe(2.0);

    // Our debounce fires: we wrote last, so storage ends at OUR value
    await vi.advanceTimersByTimeAsync(1200);
    expect(storage.lastSpeed).toBe(2.0);
  });

  it('external non-speed write does NOT cancel speed debounce', async () => {
    const storage = getMockStorage();
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Start speed debounce
    await config.save({ lastSpeed: 2.0 });
    expect(config.saveTimer).toBeDefined();

    // External context writes startHidden (not lastSpeed)
    simulateExternalStorageWrite({ startHidden: true });

    // Speed timer should still be running
    expect(config.saveTimer).toBeDefined();

    // In-memory should pick up the external startHidden
    expect(config.settings.startHidden).toBe(true);

    // Let debounce fire
    await vi.advanceTimersByTimeAsync(1200);
    expect(storage.lastSpeed).toBe(2.0);
  });

  it('session isolation holds regardless of prior echo traffic', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Full debounce cycle including our own echo arriving
    await config.save({ lastSpeed: 2.0 });
    await vi.advanceTimersByTimeAsync(1300);
    expect(config.settings.lastSpeed).toBe(2.0);

    // A later remote write is ignored — not because of echo bookkeeping
    // (there is none anymore) but because lastSpeed is never adopted.
    simulateExternalStorageWrite({ lastSpeed: 5.0 });
    expect(config.settings.lastSpeed).toBe(2.0);
    expect(getMockStorage().lastSpeed).toBe(5.0); // storage: last writer wins
  });

  // ===========================================================================
  // SECTION 8: Remaining edge cases
  // ===========================================================================

  it('concurrent saves to same key: last one wins', async () => {
    const storage = getMockStorage();
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Two saves to same key in quick succession
    await config.save({ controllerOpacity: 0.5 });
    await config.save({ controllerOpacity: 0.9 });

    await vi.advanceTimersByTimeAsync(50);

    expect(storage.controllerOpacity).toBe(0.9);
    expect(config.settings.controllerOpacity).toBe(0.9);
  });

  // ===========================================================================
  // SECTION 9: Pre-load save() guard
  // ===========================================================================

  it('save() before load() is blocked — prevents writing defaults over user data', async () => {
    const storage = getMockStorage();
    storage.lastSpeed = 2.5; // user's real persisted speed

    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    const config = new window.VSC.VideoSpeedConfig();
    // Intentionally do NOT call load()

    // Attempt to save — should be blocked
    await config.save({ startHidden: true });

    expect(mockSet).not.toHaveBeenCalled();
    expect(storage.lastSpeed).toBe(2.5);

    window.VSC.StorageManager.set = originalSet;
  });

  it('save() after load() succeeds normally', async () => {
    const storage = getMockStorage();
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config._loaded).toBe(true);

    await config.save({ startHidden: true });
    await vi.advanceTimersByTimeAsync(50);

    expect(storage.startHidden).toBe(true);
  });

  it('save() inside load() (keyBindings init) is not blocked', async () => {
    const storage = getMockStorage();
    storage.keyBindings = []; // triggers init path

    const mockSet = vi.fn(async (data) => {
      return originalSet.call(window.VSC.StorageManager, data);
    });
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = mockSet;

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    await vi.advanceTimersByTimeAsync(50);

    // The keyBindings init save inside load() should have gone through
    const keyBindingsWrite = mockSet.mock.calls
      .map((call) => Object.keys(call[0]))
      .find((keys) => keys.includes('keyBindings'));
    expect(keyBindingsWrite).toBeDefined();

    window.VSC.StorageManager.set = originalSet;
  });

  it('_loaded stays false if load() fails', async () => {
    // Temporarily break StorageManager.get to simulate failure
    const originalGet = window.VSC.StorageManager.get;
    window.VSC.StorageManager.get = async () => {
      throw new Error('storage unavailable');
    };

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config._loaded).toBe(false);

    // save() should be blocked
    const storage = getMockStorage();
    const originalSpeed = storage.lastSpeed;
    await config.save({ lastSpeed: 99 });
    expect(storage.lastSpeed).toBe(originalSpeed);

    window.VSC.StorageManager.get = originalGet;
  });

  // ===========================================================================
  // SECTION 10: save() returns boolean for persistence feedback
  // ===========================================================================

  it('save() returns true on successful persist', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const result = await config.save({ startHidden: true });
    expect(result).toBe(true);
  });

  it('save() returns false when storage write fails', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = async () => {
      throw new Error('QUOTA_BYTES_PER_ITEM exceeded');
    };

    const result = await config.save({ startHidden: true });
    expect(result).toBe(false);

    // In-memory should still be updated (current session works)
    expect(config.settings.startHidden).toBe(true);

    window.VSC.StorageManager.set = originalSet;
  });

  it('save() returns true for debounced speed saves (persistence deferred)', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const result = await config.save({ lastSpeed: 2.0 });
    expect(result).toBe(true);
  });

  it('save() returns false before load()', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    // no load()

    const result = await config.save({ startHidden: true });
    expect(result).toBe(false);
  });

  it('save({}) returns true (no-op)', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    // no load() needed — empty save short-circuits before the guard
    const result = await config.save({});
    expect(result).toBe(true);
  });

  it('debounce timer storage failure keeps in-memory state and timer bookkeeping clean', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Start debounce
    await config.save({ lastSpeed: 2.0 });

    // Break storage before timer fires
    const originalSet = window.VSC.StorageManager.set;
    window.VSC.StorageManager.set = async () => {
      throw new Error('quota exceeded');
    };

    // Wait for debounce to fire (and fail)
    await vi.advanceTimersByTimeAsync(1200);

    // Session state survives the persistence failure; no timer left behind
    expect(config.settings.lastSpeed).toBe(2.0);
    expect(config.saveTimer).toBe(null);
    expect(config.pendingSave).toBe(null);

    window.VSC.StorageManager.set = originalSet;
  });
});
