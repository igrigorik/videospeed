// Message type constants
const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY'
};

document.addEventListener("DOMContentLoaded", function () {
  // Load settings and initialize speed controls
  loadSettingsAndInitialize();

  // Settings button event listener
  document.querySelector("#config").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });

  // Power button toggle event listener
  document.querySelector("#disable").addEventListener("click", function () {
    // Toggle based on current state
    const isCurrentlyEnabled = !this.classList.contains("disabled");
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  // Initialize enabled state
  chrome.storage.sync.get({ enabled: true }, function (storage) {
    toggleEnabledUI(storage.enabled);
  });

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set(
      {
        enabled: enabled
      },
      function () {
        toggleEnabledUI(enabled);
        if (callback) callback(enabled);
      }
    );
  }

  function toggleEnabledUI(enabled) {
    const disableBtn = document.querySelector("#disable");
    disableBtn.classList.toggle("disabled", !enabled);

    // Update tooltip
    disableBtn.title = enabled ? "Disable Extension" : "Enable Extension";

    const suffix = enabled ? "" : "_disabled";
    chrome.action.setIcon({
      path: {
        "19": chrome.runtime.getURL(`assets/icons/icon19${suffix}.png`),
        "38": chrome.runtime.getURL(`assets/icons/icon38${suffix}.png`),
        "48": chrome.runtime.getURL(`assets/icons/icon48${suffix}.png`)
      }
    });

    // Notify background script of state change
    chrome.runtime.sendMessage({ type: 'EXTENSION_TOGGLE', enabled: enabled });
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage(
      `${enabled ? "Enabled" : "Disabled"}. Reload page.`
    );
  }

  function setStatusMessage(str) {
    const status_element = document.querySelector("#status");
    status_element.classList.toggle("hide", false);
    status_element.innerText = str;
  }

  // Load settings and initialize UI
  function loadSettingsAndInitialize() {
    chrome.storage.sync.get(null, function (storage) {
      // Find the step values from keyBindings
      let slowerStep = 0.1;
      let fasterStep = 0.1;
      let resetSpeed = 1.0;

      if (storage.keyBindings && Array.isArray(storage.keyBindings)) {
        const slowerBinding = storage.keyBindings.find(kb => kb.action === "slower");
        const fasterBinding = storage.keyBindings.find(kb => kb.action === "faster");
        const fastBinding = storage.keyBindings.find(kb => kb.action === "fast");

        if (slowerBinding && typeof slowerBinding.value === 'number') {
          slowerStep = slowerBinding.value;
        }
        if (fasterBinding && typeof fasterBinding.value === 'number') {
          fasterStep = fasterBinding.value;
        }
        if (fastBinding && typeof fastBinding.value === 'number') {
          resetSpeed = fastBinding.value;
        }
      }

      // Update the UI with dynamic values
      updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed);

      // Initialize event listeners
      initializeSpeedControls(slowerStep, fasterStep);
    });
  }

  function updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed) {
    // Update decrease button
    const decreaseBtn = document.querySelector("#speed-decrease");
    if (decreaseBtn) {
      decreaseBtn.dataset.delta = -slowerStep;
      decreaseBtn.querySelector("span").textContent = `-${slowerStep}`;
    }

    // Update increase button  
    const increaseBtn = document.querySelector("#speed-increase");
    if (increaseBtn) {
      increaseBtn.dataset.delta = fasterStep;
      increaseBtn.querySelector("span").textContent = `+${fasterStep}`;
    }

    // Update reset button
    const resetBtn = document.querySelector("#speed-reset");
    if (resetBtn) {
      resetBtn.textContent = resetSpeed.toString();
    }
  }

  // Speed Control Functions
  function initializeSpeedControls(slowerStep, fasterStep) {
    // Set up speed control button listeners
    document.querySelector("#speed-decrease").addEventListener("click", function () {
      const delta = parseFloat(this.dataset.delta);
      adjustSpeed(delta);
    });

    document.querySelector("#speed-increase").addEventListener("click", function () {
      const delta = parseFloat(this.dataset.delta);
      adjustSpeed(delta);
    });

    document.querySelector("#speed-reset").addEventListener("click", function () {
      // Set directly to preferred speed instead of toggling
      const preferredSpeed = parseFloat(this.textContent);
      setSpeed(preferredSpeed);
    });

    // Set up preset button listeners
    document.querySelectorAll(".preset-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        const speed = parseFloat(this.dataset.speed);
        setSpeed(speed);
      });
    });
  }

  function setSpeed(speed) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.SET_SPEED,
          payload: { speed: speed }
        });
      }
    });
  }

  function adjustSpeed(delta) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.ADJUST_SPEED,
          payload: { delta: delta }
        });
      }
    });
  }

  function resetSpeed() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.RESET_SPEED
        });
      }
    });
  }
});
