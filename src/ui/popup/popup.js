// Message type constants
const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  SET_VOLUME: 'VSC_SET_VOLUME',
  GET_VOLUME_STATE: 'VSC_GET_VOLUME_STATE',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
};

const DEFAULT_VOLUME_LEVEL = 1;
const MAX_VOLUME_LEVEL = 4;

document.addEventListener('DOMContentLoaded', () => {
  // Load settings and initialize speed controls
  loadSettingsAndInitialize();

  // Settings button event listener
  document.querySelector('#config').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Power button toggle event listener
  document.querySelector('#disable').addEventListener('click', function () {
    // Toggle based on current state
    const isCurrentlyEnabled = !this.classList.contains('disabled');
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  // Initialize enabled state
  chrome.storage.sync.get({ enabled: true }, (storage) => {
    toggleEnabledUI(storage.enabled);
  });

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set(
      {
        enabled: enabled,
      },
      () => {
        toggleEnabledUI(enabled);
        if (callback) {
          callback(enabled);
        }
      }
    );
  }

  function toggleEnabledUI(enabled) {
    const disableBtn = document.querySelector('#disable');
    disableBtn.classList.toggle('disabled', !enabled);

    // Update tooltip
    disableBtn.title = enabled ? 'Disable Extension' : 'Enable Extension';
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage(`${enabled ? 'Enabled' : 'Disabled'}. Reload page.`);
  }

  function setStatusMessage(str) {
    const statusElement = document.querySelector('#status');
    statusElement.classList.toggle('hide', false);
    statusElement.innerText = str;
  }

  function sendActiveTabMessage(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        if (callback) {
          callback(null);
        }
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) {
          if (callback) {
            callback(null);
          }
          return;
        }

        if (callback) {
          callback(response);
        }
      });
    });
  }

  // Load settings and initialize UI
  function loadSettingsAndInitialize() {
    chrome.storage.sync.get(null, (storage) => {
      // Find the step values from keyBindings
      let slowerStep = 0.1;
      let fasterStep = 0.1;
      let resetSpeed = 1.0;
      let softerStep = 0.1;
      let louderStep = 0.1;

      if (storage.keyBindings && Array.isArray(storage.keyBindings)) {
        const slowerBinding = storage.keyBindings.find((kb) => kb.action === 'slower');
        const fasterBinding = storage.keyBindings.find((kb) => kb.action === 'faster');
        const fastBinding = storage.keyBindings.find((kb) => kb.action === 'fast');
        const softerBinding = storage.keyBindings.find((kb) => kb.action === 'softer');
        const louderBinding = storage.keyBindings.find((kb) => kb.action === 'louder');

        if (slowerBinding && typeof slowerBinding.value === 'number') {
          slowerStep = slowerBinding.value;
        }
        if (fasterBinding && typeof fasterBinding.value === 'number') {
          fasterStep = fasterBinding.value;
        }
        if (fastBinding && typeof fastBinding.value === 'number') {
          resetSpeed = fastBinding.value;
        }
        if (softerBinding && typeof softerBinding.value === 'number') {
          softerStep = softerBinding.value;
        }
        if (louderBinding && typeof louderBinding.value === 'number') {
          louderStep = louderBinding.value;
        }
      }

      // Update the UI with dynamic values
      updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed);
      updateVolumeControlsUI(softerStep, louderStep);

      // Initialize event listeners
      initializeSpeedControls();
      initializeVolumeControls();
      loadActiveVolumeState();
    });
  }

  function updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed) {
    // Update decrease button
    const decreaseBtn = document.querySelector('#speed-decrease');
    if (decreaseBtn) {
      decreaseBtn.dataset.delta = -slowerStep;
      decreaseBtn.querySelector('span').textContent = `-${slowerStep}`;
    }

    // Update increase button
    const increaseBtn = document.querySelector('#speed-increase');
    if (increaseBtn) {
      increaseBtn.dataset.delta = fasterStep;
      increaseBtn.querySelector('span').textContent = `+${fasterStep}`;
    }

    // Update reset button
    const resetBtn = document.querySelector('#speed-reset');
    if (resetBtn) {
      resetBtn.textContent = resetSpeed.toString();
    }
  }

  function updateVolumeControlsUI(softerStep, louderStep) {
    const slider = document.querySelector('#volume-range');
    if (!slider) {
      return;
    }

    const stepCandidates = [softerStep, louderStep].filter(
      (value) => typeof value === 'number' && value > 0
    );
    const sliderStep = stepCandidates.length > 0 ? Math.min(...stepCandidates) : 0.1;

    slider.step = sliderStep.toString();
    syncVolumeUI(Number(slider.value || DEFAULT_VOLUME_LEVEL));
  }

  function syncVolumeUI(level) {
    const slider = document.querySelector('#volume-range');
    const valueLabel = document.querySelector('#volume-value');
    if (!slider || !valueLabel) {
      return;
    }

    const clampedLevel = Math.min(Math.max(level, 0), MAX_VOLUME_LEVEL);
    slider.value = clampedLevel.toString();
    valueLabel.textContent = `${Math.round(clampedLevel * 100)}%`;
  }

  function loadActiveVolumeState() {
    sendActiveTabMessage({ type: MessageTypes.GET_VOLUME_STATE }, (response) => {
      if (response && typeof response.level === 'number') {
        syncVolumeUI(response.level);
      } else {
        syncVolumeUI(DEFAULT_VOLUME_LEVEL);
      }
    });
  }

  // Speed Control Functions
  function initializeSpeedControls() {
    // Set up speed control button listeners
    document.querySelector('#speed-decrease').addEventListener('click', function () {
      const delta = parseFloat(this.dataset.delta);
      adjustSpeed(delta);
    });

    document.querySelector('#speed-increase').addEventListener('click', function () {
      const delta = parseFloat(this.dataset.delta);
      adjustSpeed(delta);
    });

    document.querySelector('#speed-reset').addEventListener('click', function () {
      // Set directly to reset speed instead of toggling
      const resetSpeed = parseFloat(this.textContent);
      setSpeed(resetSpeed);
    });

    // Set up preset button listeners
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const speed = parseFloat(this.dataset.speed);
        setSpeed(speed);
      });
    });
  }

  function initializeVolumeControls() {
    const slider = document.querySelector('#volume-range');
    if (!slider) {
      return;
    }

    slider.addEventListener('input', function () {
      const level = parseFloat(this.value);
      syncVolumeUI(level);
      setVolume(level);
    });
  }

  function setSpeed(speed) {
    sendActiveTabMessage({
      type: MessageTypes.SET_SPEED,
      payload: { speed: speed },
    });
  }

  function adjustSpeed(delta) {
    sendActiveTabMessage({
      type: MessageTypes.ADJUST_SPEED,
      payload: { delta: delta },
    });
  }

  function setVolume(level) {
    sendActiveTabMessage({
      type: MessageTypes.SET_VOLUME,
      payload: { level: level },
    });
  }
});
