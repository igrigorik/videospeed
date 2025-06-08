// Message type constants - namespaced for defensive messaging
const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY'
};

document.addEventListener("DOMContentLoaded", function () {
  // Initialize speed controls
  initializeSpeedControls();

  // Settings button event listener
  document.querySelector("#config").addEventListener("click", function () {
    window.open(chrome.runtime.getURL("options.html"));
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

    const suffix = `${enabled ? "" : "_disabled"}.png`;
    chrome.action.setIcon({
      path: {
        "19": "icons/icon19" + suffix,
        "38": "icons/icon38" + suffix,
        "48": "icons/icon48" + suffix
      }
    });
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

  // Speed Control Functions
  function initializeSpeedControls() {
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
      resetSpeed();
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
