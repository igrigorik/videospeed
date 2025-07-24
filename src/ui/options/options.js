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
  if (
    (e.keyCode >= 48 && e.keyCode <= 57) || // Numbers 0-9
    (e.keyCode >= 65 && e.keyCode <= 90) || // Letters A-Z
    keyCodeAliases[e.keyCode] // Other character keys
  ) {
    e.target.value =
      keyCodeAliases[e.keyCode] || String.fromCharCode(e.keyCode);
    e.target.keyCode = e.keyCode;

    e.preventDefault();
    e.stopPropagation();
  } else if (e.keyCode === 8) {
    // Clear input when backspace pressed
    e.target.value = "";
  } else if (e.keyCode === 27) {
    // When esc clicked, clear input
    e.target.value = "null";
    e.target.keyCode = null;
  }
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
  e.target.value =
    keyCodeAliases[e.target.keyCode] || String.fromCharCode(e.target.keyCode);
}

function updateShortcutInputText(inputId, keyCode) {
  document.getElementById(inputId).value =
    keyCodeAliases[keyCode] || String.fromCharCode(keyCode);
  document.getElementById(inputId).keyCode = keyCode;
}

function updateCustomShortcutInputText(inputItem, keyCode) {
  inputItem.value = keyCodeAliases[keyCode] || String.fromCharCode(keyCode);
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
    <select class="customForce">
    <option value="false">Do not disable website key bindings</option>
    <option value="true">Disable website key bindings</option>
    </select>
    <button class="removeParent">X</button>`;
  var div = document.createElement("div");
  div.setAttribute("class", "row customs");
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(
    div,
    customs_element.children[customs_element.childElementCount - 1]
  );
}

function createKeyBindings(item) {
  const action = item.querySelector(".customDo").value;
  const key = item.querySelector(".customKey").keyCode;
  const value = Number(item.querySelector(".customValue").value);
  const force = item.querySelector(".customForce").value;
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
        valid = false;
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
    setTimeout(function () {
      status.textContent = "";
    }, 1000);

  } catch (error) {
    console.error("Failed to save options:", error);
    status.textContent = "Error saving options: " + error.message;
    setTimeout(function () {
      status.textContent = "";
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
        
        console.log(`Debug: DOM elements for ${item.action}:`, {keyInput, valueInput, forceInput});
        
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
        dom.querySelector(".customForce").value = String(item["force"]);
      }
    }
  } catch (error) {
    console.error("Failed to restore options:", error);
    document.getElementById("status").textContent = "Error loading options: " + error.message;
  }
}

async function restore_defaults() {
  try {
    var status = document.getElementById("status");
    status.textContent = "Restoring defaults...";

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
    setTimeout(function () {
      status.textContent = "";
    }, 1000);
  } catch (error) {
    console.error("Failed to restore defaults:", error);
    document.getElementById("status").textContent = "Error restoring defaults: " + error.message;
  }
}

function show_experimental() {
  const forceElements = document.querySelectorAll(".customForce");
  const button = document.getElementById("experimental");

  if (forceElements.length > 0) {
    forceElements.forEach((item) => {
      item.style.display = "inline-block";
    });

    // Update button text to indicate the feature is now enabled
    button.textContent = "Advanced features enabled";
    button.disabled = true;
  }
}

// Create debounced save function to prevent rapid saves
const debouncedSave = debounce(save_options, 300);

document.addEventListener("DOMContentLoaded", async function () {
  await restore_options();

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
