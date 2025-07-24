// Initialize global namespace for options page
window.VSC = window.VSC || {};

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

var keyBindings = [];

// Minimal blacklist - only keys that would interfere with form navigation
const BLACKLISTED_KEYCODES = [
  9,   // Tab - needed for keyboard navigation
  16,  // Shift (alone)
  17,  // Ctrl/Control (alone)
  18,  // Alt (alone)
  91,  // Meta/Windows/Command Left
  92,  // Meta/Windows Right
  93,  // Context Menu/Right Command
  224  // Meta/Command (Firefox)
];

var keyCodeAliases = {
  0: "null",
  null: "null",
  undefined: "null",
  32: "Space",
  37: "Left",
  38: "Up",
  39: "Right",
  40: "Down",
  96: "Num 0",
  97: "Num 1",
  98: "Num 2",
  99: "Num 3",
  100: "Num 4",
  101: "Num 5",
  102: "Num 6",
  103: "Num 7",
  104: "Num 8",
  105: "Num 9",
  106: "Num *",
  107: "Num +",
  109: "Num -",
  110: "Num .",
  111: "Num /",
  112: "F1",
  113: "F2",
  114: "F3",
  115: "F4",
  116: "F5",
  117: "F6",
  118: "F7",
  119: "F8",
  120: "F9",
  121: "F10",
  122: "F11",
  123: "F12",
  124: "F13",
  125: "F14",
  126: "F15",
  127: "F16",
  128: "F17",
  129: "F18",
  130: "F19",
  131: "F20",
  132: "F21",
  133: "F22",
  134: "F23",
  135: "F24",
  186: ";",
  188: "<",
  189: "-",
  187: "+",
  190: ">",
  191: "/",
  192: "~",
  219: "[",
  220: "\\",
  221: "]",
  222: "'"
};

function recordKeyPress(e) {
  // Special handling for backspace and escape
  if (e.keyCode === 8) {
    // Clear input when backspace pressed
    e.target.value = "";
    e.preventDefault();
    e.stopPropagation();
    return;
  } else if (e.keyCode === 27) {
    // When esc clicked, clear input
    e.target.value = "null";
    e.target.keyCode = null;
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Block blacklisted keys
  if (BLACKLISTED_KEYCODES.includes(e.keyCode)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Accept all other keys
  // Use friendly name if available, otherwise show "Key {code}"
  e.target.value = keyCodeAliases[e.keyCode] ||
    (e.keyCode >= 48 && e.keyCode <= 90 ? String.fromCharCode(e.keyCode) : `Key ${e.keyCode}`);
  e.target.keyCode = e.keyCode;

  e.preventDefault();
  e.stopPropagation();
}

function inputFilterNumbersOnly(e) {
  var char = String.fromCharCode(e.keyCode);
  if (!/[\d\.]$/.test(char) || !/^\d+(\.\d*)?$/.test(e.target.value + char)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function inputFocus(e) {
  e.target.value = "";
}

function inputBlur(e) {
  const keyCode = e.target.keyCode;
  e.target.value = keyCodeAliases[keyCode] ||
    (keyCode >= 48 && keyCode <= 90 ? String.fromCharCode(keyCode) : `Key ${keyCode}`);
}

function updateShortcutInputText(inputId, keyCode) {
  const input = document.getElementById(inputId);
  input.value = keyCodeAliases[keyCode] ||
    (keyCode >= 48 && keyCode <= 90 ? String.fromCharCode(keyCode) : `Key ${keyCode}`);
  input.keyCode = keyCode;
}

function updateCustomShortcutInputText(inputItem, keyCode) {
  inputItem.value = keyCodeAliases[keyCode] ||
    (keyCode >= 48 && keyCode <= 90 ? String.fromCharCode(keyCode) : `Key ${keyCode}`);
  inputItem.keyCode = keyCode;
}


function add_shortcut() {
  var html = `<select class="customDo">
    <option value="slower">Decrease speed</option>
    <option value="faster">Increase speed</option>
    <option value="rewind">Rewind</option>
    <option value="advance">Advance</option>
    <option value="reset">Reset speed</option>
    <option value="fast">Preferred speed</option>
    <option value="muted">Mute</option>
    <option value="softer">Decrease volume</option>
    <option value="louder">Increase volume</option>
    <option value="pause">Pause</option>
    <option value="mark">Set marker</option>
    <option value="jump">Jump to marker</option>
    <option value="display">Show/hide controller</option>
    </select>
    <input class="customKey" type="text" placeholder="press a key"/>
    <input class="customValue" type="text" placeholder="value (0.10)"/>
    <button class="removeParent">X</button>`;
  var div = document.createElement("div");
  div.setAttribute("class", "row customs");
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(
    div,
    customs_element.children[customs_element.childElementCount - 1]
  );

  // If experimental features are already enabled, add the force select
  const experimentalButton = document.getElementById("experimental");
  if (experimentalButton && experimentalButton.disabled) {
    const customValue = div.querySelector('.customValue');
    const select = document.createElement('select');
    select.className = 'customForce show';
    select.innerHTML = `
      <option value="false">Default behavior</option>
      <option value="true">Override site keys</option>
    `;
    customValue.parentNode.insertBefore(select, customValue.nextSibling);
  }
}

function createKeyBindings(item) {
  const action = item.querySelector(".customDo").value;
  const key = item.querySelector(".customKey").keyCode;
  const value = Number(item.querySelector(".customValue").value);
  const forceElement = item.querySelector(".customForce");
  const force = forceElement ? forceElement.value : "false";
  const predefined = !!item.id; //item.id ? true : false;

  keyBindings.push({
    action: action,
    key: key,
    value: value,
    force: force,
    predefined: predefined
  });
}

// Validates settings before saving
function validate() {
  var valid = true;
  var status = document.getElementById("status");
  var blacklist = document.getElementById("blacklist");

  // Clear any existing timeout for validation errors
  if (window.validationTimeout) {
    clearTimeout(window.validationTimeout);
  }

  blacklist.value.split("\n").forEach((match) => {
    match = match.replace(window.VSC.Constants.regStrip, "");

    if (match.startsWith("/")) {
      try {
        var parts = match.split("/");

        if (parts.length < 3)
          throw "invalid regex";

        var flags = parts.pop();
        var regex = parts.slice(1).join("/");

        var regexp = new RegExp(regex, flags);
      } catch (err) {
        status.textContent =
          "Error: Invalid blacklist regex: \"" + match + "\". Unable to save. Try wrapping it in foward slashes.";
        status.classList.add("show", "error");
        valid = false;

        // Auto-hide validation error after 5 seconds
        window.validationTimeout = setTimeout(function () {
          status.textContent = "";
          status.classList.remove("show", "error");
        }, 5000);

        return;
      }
    }
  });
  return valid;
}

// Saves options using VideoSpeedConfig system
async function save_options() {
  if (validate() === false) {
    return;
  }

  var status = document.getElementById("status");
  status.textContent = "Saving...";
  status.classList.remove("success", "error"); // Clear any previous state
  status.classList.add("show");

  try {
    keyBindings = [];
    Array.from(document.querySelectorAll(".customs")).forEach((item) =>
      createKeyBindings(item)
    );

    // Ensure force values are boolean, not string
    keyBindings = keyBindings.map(binding => ({
      ...binding,
      force: Boolean(binding.force === "true" || binding.force === true)
    }));

    var rememberSpeed = document.getElementById("rememberSpeed").checked;
    var forceLastSavedSpeed = document.getElementById("forceLastSavedSpeed").checked;
    var audioBoolean = document.getElementById("audioBoolean").checked;
    var startHidden = document.getElementById("startHidden").checked;
    var controllerOpacity = Number(document.getElementById("controllerOpacity").value);
    var controllerButtonSize = Number(document.getElementById("controllerButtonSize").value);
    var logLevel = parseInt(document.getElementById("logLevel").value);
    var blacklist = document.getElementById("blacklist").value;

    // Clean up legacy keys
    await chrome.storage.sync.remove([
      "resetSpeed",
      "speedStep",
      "fastSpeed",
      "rewindTime",
      "advanceTime",
      "resetKeyCode",
      "slowerKeyCode",
      "fasterKeyCode",
      "rewindKeyCode",
      "advanceKeyCode",
      "fastKeyCode"
    ]);

    // Ensure VideoSpeedConfig singleton is initialized
    if (!window.VSC.videoSpeedConfig) {
      window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
    }

    // Use VideoSpeedConfig to save settings
    const settingsToSave = {
      rememberSpeed: rememberSpeed,
      forceLastSavedSpeed: forceLastSavedSpeed,
      audioBoolean: audioBoolean,
      startHidden: startHidden,
      controllerOpacity: controllerOpacity,
      controllerButtonSize: controllerButtonSize,
      logLevel: logLevel,
      keyBindings: keyBindings,
      blacklist: blacklist.replace(window.VSC.Constants.regStrip, "")
    };

    await window.VSC.videoSpeedConfig.save(settingsToSave);

    // Validate that settings were actually saved by reading them back
    await window.VSC.videoSpeedConfig.load();
    const savedSettings = window.VSC.videoSpeedConfig.settings;

    // Basic validation - check that keyBindings were saved correctly
    if (!savedSettings.keyBindings || savedSettings.keyBindings.length !== keyBindings.length) {
      throw new Error("Keyboard shortcuts may not have been saved correctly");
    }

    status.textContent = "Options saved";
    status.classList.add("success");
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "success");
    }, 2000);

  } catch (error) {
    console.error("Failed to save options:", error);
    status.textContent = "Error saving options: " + error.message;
    status.classList.add("show", "error");
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "error");
    }, 3000);
  }
}

// Restores options using VideoSpeedConfig system
async function restore_options() {
  try {
    // Ensure VideoSpeedConfig singleton is initialized
    if (!window.VSC.videoSpeedConfig) {
      window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
    }

    // Load settings using VideoSpeedConfig
    await window.VSC.videoSpeedConfig.load();
    const storage = window.VSC.videoSpeedConfig.settings;

    document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
    document.getElementById("forceLastSavedSpeed").checked = storage.forceLastSavedSpeed;
    document.getElementById("audioBoolean").checked = storage.audioBoolean;
    document.getElementById("startHidden").checked = storage.startHidden;
    document.getElementById("controllerOpacity").value = storage.controllerOpacity;
    document.getElementById("controllerButtonSize").value = storage.controllerButtonSize;
    document.getElementById("logLevel").value = storage.logLevel;
    document.getElementById("blacklist").value = storage.blacklist;

    // Process key bindings
    const keyBindings = storage.keyBindings || window.VSC.Constants.DEFAULT_SETTINGS.keyBindings;

    console.log('Debug: storage object:', storage);
    console.log('Debug: keyBindings:', keyBindings);
    console.log('Debug: DEFAULT_SETTINGS:', window.VSC.Constants.DEFAULT_SETTINGS);

    for (let i in keyBindings) {
      var item = keyBindings[i];
      console.log(`Debug: Processing binding ${i}:`, item);

      if (item.predefined) {
        // Handle predefined shortcuts
        if (item["action"] == "display" && typeof item["key"] === "undefined") {
          item["key"] = storage.displayKeyCode || window.VSC.Constants.DEFAULT_SETTINGS.displayKeyCode;
        }

        if (window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES.includes(item["action"])) {
          const valueInput = document.querySelector("#" + item["action"] + " .customValue");
          if (valueInput) {
            valueInput.style.display = "none";
          }
        }

        const keyInput = document.querySelector("#" + item["action"] + " .customKey");
        const valueInput = document.querySelector("#" + item["action"] + " .customValue");
        const forceInput = document.querySelector("#" + item["action"] + " .customForce");

        console.log(`Debug: DOM elements for ${item.action}:`, { keyInput, valueInput, forceInput });

        if (keyInput) {
          updateCustomShortcutInputText(keyInput, item["key"]);
        }
        if (valueInput) {
          valueInput.value = item["value"];
        }
        if (forceInput) {
          forceInput.value = String(item["force"]);
        }
      } else {
        // Handle custom shortcuts
        add_shortcut();
        const dom = document.querySelector(".customs:last-of-type");
        dom.querySelector(".customDo").value = item["action"];

        if (window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES.includes(item["action"])) {
          const valueInput = dom.querySelector(".customValue");
          if (valueInput) {
            valueInput.style.display = "none";
          }
        }

        updateCustomShortcutInputText(
          dom.querySelector(".customKey"),
          item["key"]
        );
        dom.querySelector(".customValue").value = item["value"];
        // If force value exists in settings but element doesn't exist, create it
        if (item["force"] !== undefined && !dom.querySelector(".customForce")) {
          const customValue = dom.querySelector('.customValue');
          const select = document.createElement('select');
          select.className = 'customForce'; // Don't add 'show' class initially
          select.innerHTML = `
            <option value="false">Default behavior</option>
            <option value="true">Override site keys</option>
          `;
          select.value = String(item["force"]);
          customValue.parentNode.insertBefore(select, customValue.nextSibling);
        } else {
          const forceSelect = dom.querySelector(".customForce");
          if (forceSelect) {
            forceSelect.value = String(item["force"]);
          }
        }
      }
    }

    // Check if any keybindings have force property set, if so, show experimental features
    const hasExperimentalFeatures = keyBindings.some(kb => kb.force !== undefined && kb.force !== false);
    if (hasExperimentalFeatures) {
      show_experimental();
    }
  } catch (error) {
    console.error("Failed to restore options:", error);
    document.getElementById("status").textContent = "Error loading options: " + error.message;
    document.getElementById("status").classList.add("show", "error");
    setTimeout(function () {
      document.getElementById("status").textContent = "";
      document.getElementById("status").classList.remove("show", "error");
    }, 3000);
  }
}

async function restore_defaults() {
  try {
    var status = document.getElementById("status");
    status.textContent = "Restoring defaults...";
    status.classList.remove("success", "error"); // Clear any previous state
    status.classList.add("show");

    // Ensure VideoSpeedConfig singleton is initialized
    if (!window.VSC.videoSpeedConfig) {
      window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
    }

    // Use VideoSpeedConfig to restore defaults
    await window.VSC.videoSpeedConfig.save(window.VSC.Constants.DEFAULT_SETTINGS);

    // Remove any custom shortcuts from the UI
    document
      .querySelectorAll(".removeParent")
      .forEach((button) => button.click());

    // Reload the options
    await restore_options();

    status.textContent = "Default options restored";
    status.classList.add("success");
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "success");
    }, 2000);
  } catch (error) {
    console.error("Failed to restore defaults:", error);
    document.getElementById("status").textContent = "Error restoring defaults: " + error.message;
    document.getElementById("status").classList.add("show", "error");
    setTimeout(function () {
      document.getElementById("status").textContent = "";
      document.getElementById("status").classList.remove("show", "error");
    }, 3000);
  }
}

function show_experimental() {
  const button = document.getElementById("experimental");
  const customRows = document.querySelectorAll('.row.customs');
  const advancedRows = document.querySelectorAll('.row.advanced-feature');

  // Show advanced feature rows
  advancedRows.forEach((row) => {
    row.classList.add('show');
  });

  // Create the select template
  const createForceSelect = () => {
    const select = document.createElement('select');
    select.className = 'customForce show';
    select.innerHTML = `
      <option value="false">Allow event propagation</option>
      <option value="true">Disable event propagation</option>
    `;
    return select;
  };

  // Add select to each row
  customRows.forEach((row) => {
    const existingSelect = row.querySelector('.customForce');

    if (!existingSelect) {
      // Create new select if it doesn't exist
      const customValue = row.querySelector('.customValue');
      const newSelect = createForceSelect();

      // Check if this row has saved force value
      const rowId = row.id;
      if (rowId && window.VSC.videoSpeedConfig && window.VSC.videoSpeedConfig.settings.keyBindings) {
        // For predefined shortcuts
        const savedBinding = window.VSC.videoSpeedConfig.settings.keyBindings.find(kb => kb.action === rowId);
        if (savedBinding && savedBinding.force !== undefined) {
          newSelect.value = String(savedBinding.force);
        }
      } else if (!rowId) {
        // For custom shortcuts, try to find the force value from the current keyBindings array
        const rowIndex = Array.from(row.parentElement.querySelectorAll('.row.customs:not([id])')).indexOf(row);
        const customBindings = window.VSC.videoSpeedConfig?.settings.keyBindings?.filter(kb => !kb.predefined) || [];
        if (customBindings[rowIndex] && customBindings[rowIndex].force !== undefined) {
          newSelect.value = String(customBindings[rowIndex].force);
        }
      }

      // Insert after the customValue input
      if (customValue) {
        customValue.parentNode.insertBefore(newSelect, customValue.nextSibling);
      }
    } else {
      // If it already exists, just show it
      existingSelect.classList.add('show');
    }
  });

  // Update button text to indicate the feature is now enabled
  button.textContent = "Advanced features enabled";
  button.disabled = true;
}

// Create debounced save function to prevent rapid saves
const debouncedSave = debounce(save_options, 300);

document.addEventListener("DOMContentLoaded", async function () {
  await restore_options();

  // Disable action dropdowns for predefined shortcuts
  document.querySelectorAll('.row.customs[id] .customDo').forEach(select => {
    select.disabled = true;
  });

  document.getElementById("save").addEventListener("click", async (e) => {
    e.preventDefault();
    await save_options();
  });

  document.getElementById("add").addEventListener("click", add_shortcut);

  document.getElementById("restore").addEventListener("click", async (e) => {
    e.preventDefault();
    await restore_defaults();
  });

  document.getElementById("experimental").addEventListener("click", show_experimental);

  // About and feedback button event listeners
  document.getElementById("about").addEventListener("click", function () {
    window.open("https://github.com/igrigorik/videospeed");
  });

  document.getElementById("feedback").addEventListener("click", function () {
    window.open("https://github.com/igrigorik/videospeed/issues");
  });

  function eventCaller(event, className, funcName) {
    if (!event.target.classList.contains(className)) {
      return;
    }
    funcName(event);
  }

  document.addEventListener("keypress", (event) => {
    eventCaller(event, "customValue", inputFilterNumbersOnly);
  });
  document.addEventListener("focus", (event) => {
    eventCaller(event, "customKey", inputFocus);
  });
  document.addEventListener("blur", (event) => {
    eventCaller(event, "customKey", inputBlur);
  });
  document.addEventListener("keydown", (event) => {
    eventCaller(event, "customKey", recordKeyPress);
  });
  document.addEventListener("click", (event) => {
    eventCaller(event, "removeParent", function () {
      event.target.parentNode.remove();
    });
  });
  document.addEventListener("change", (event) => {
    eventCaller(event, "customDo", function () {
      const valueInput = event.target.nextElementSibling.nextElementSibling;
      if (window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES.includes(event.target.value)) {
        valueInput.style.display = "none";
        valueInput.value = 0;
      } else {
        valueInput.style.display = "inline-block";
      }
    });
  });
});
