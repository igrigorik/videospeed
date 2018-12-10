var tcDefaults = {
  speed: 1.0,           // default:
  displayKeyCode: 86,   // default: V
  rememberSpeed: false, // default: false
  startHidden: false,   // default: false
  keyBindings: [
    {action: "slower", key: 83, value: 0.1, force: false, predefined: true}, // S
    {action: "faster", key: 68, value: 0.1, force: false, predefined: true}, // D
    {action: "rewind", key: 90, value: 10, force: false, predefined: true}, // Z
    {action: "advance", key: 88, value: 10, force: false, predefined: true}, // X
    {action: "reset", key: 82, value: 1, force: false, predefined: true}, // R
    {action: "fast", key: 71, value: 1.8, force: false, predefined: true} // G
  ],
  blacklist: `
    www.instagram.com
    twitter.com
    vine.co
    imgur.com
  `.replace(/^\s+|\s+$/gm, '')
};

var keyBindings = [];

var keyCodeAliases = {
  0: 'null',
  null: 'null',
  undefined: 'null',
  32: 'Space',
  96: 'Num 0',
  97: 'Num 1',
  98: 'Num 2',
  99: 'Num 3',
  100: 'Num 4',
  101: 'Num 5',
  102: 'Num 6',
  103: 'Num 7',
  104: 'Num 8',
  105: 'Num 9',
  106: 'Num *',
  107: 'Num +',
  109: 'Num -',
  110: 'Num .',
  111: 'Num /',
  186: ';',
  188: '<',
  189: '-',
  187: '+',
  190: '>',
  191: '/',
  192: '~',
  219: '[',
  220: '\\',
  221: ']',
  222: '\'',
}

function recordKeyPress(e) {
  if (
    (e.keyCode >= 48 && e.keyCode <= 57)    // Numbers 0-9
    || (e.keyCode >= 65 && e.keyCode <= 90) // Letters A-Z
    || keyCodeAliases[e.keyCode]            // Other character keys
  ) {
    e.target.value = keyCodeAliases[e.keyCode] || String.fromCharCode(e.keyCode);
    e.target.keyCode = e.keyCode;

    e.preventDefault();
    e.stopPropagation();
  } else if (e.keyCode === 8) { // Clear input when backspace pressed
    e.target.value = '';
  } else if (e.keyCode === 27) { // When esc clicked, clear input
    e.target.value = 'null';
    e.target.keyCode = null;
  }
};

function inputFilterNumbersOnly(e) {
  var char = String.fromCharCode(e.keyCode);
  if (!/[\d\.]$/.test(char) || !/^\d+(\.\d*)?$/.test(e.target.value + char)) {
    e.preventDefault();
    e.stopPropagation();
  }
};

function inputFocus(e) {
   e.target.value = "";
};

function inputBlur(e) {
  e.target.value = keyCodeAliases[e.target.keyCode] || String.fromCharCode(e.target.keyCode);
};

function updateShortcutInputText(inputId, keyCode) {
  document.getElementById(inputId).value = keyCodeAliases[keyCode] || String.fromCharCode(keyCode);
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
    <option value="pause">Pause</option>
    </select> 
    <input class="customKey" type="text" placeholder="press a key"/> 
    <input class="customValue" type="text" placeholder="value (0.10)"/> 
    <select class="customForce">
    <option value="false">Do not disable website key bindings</option>
    <option value="true">Disable websites key bindings</option>
    </select>
    <button class="removeParent">X</button>`;
  var div = document.createElement('div');
  div.setAttribute('class', 'row customs');
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(div, customs_element.children[customs_element.childElementCount - 1]);
}

function createKeyBindings(item) {
  const action = item.querySelector(".customDo").value;
  const key = item.querySelector(".customKey").keyCode;
  const value = Number(item.querySelector(".customValue").value);
  const force = item.querySelector(".customForce").value;
  const predefined = !!item.id;//item.id ? true : false;

  keyBindings.push({action: action, key: key, value: value, force: force, predefined: predefined});
}

// Saves options to chrome.storage
function save_options() {
  keyBindings = [];
  Array.from(document.querySelectorAll(".customs")).forEach(item => createKeyBindings(item)); // Remove added shortcuts

  var displayKeyCode = document.getElementById('displayKeyInput').keyCode;
  var rememberSpeed = document.getElementById('rememberSpeed').checked;
  var startHidden = document.getElementById('startHidden').checked;
  var blacklist     = document.getElementById('blacklist').value;

  displayKeyCode = isNaN(displayKeyCode) ? tcDefaults.displayKeyCode : displayKeyCode;

  chrome.storage.sync.remove(["resetSpeed", "speedStep", "fastSpeed", "rewindTime", "advanceTime", "resetKeyCode", "slowerKeyCode", "fasterKeyCode", "rewindKeyCode", "advanceKeyCode", "fastKeyCode"]);
  chrome.storage.sync.set({
    displayKeyCode: displayKeyCode,
    rememberSpeed:  rememberSpeed,
    startHidden:    startHidden,
    keyBindings:    keyBindings,
    blacklist:      blacklist.replace(/^\s+|\s+$/gm,'')
  }, function() {
    // Update status to let user know options were saved.
    var status = document.getElementById('status');
    status.textContent = 'Options saved';
    setTimeout(function() {
      status.textContent = '';
    }, 1000);
  });
}

// Restores options from chrome.storage
function restore_options() {
  chrome.storage.sync.get(tcDefaults, function(storage) {
    updateShortcutInputText('displayKeyInput', storage.displayKeyCode);
    document.getElementById('rememberSpeed').checked = storage.rememberSpeed;
    document.getElementById('startHidden').checked = storage.startHidden;
    document.getElementById('blacklist').value = storage.blacklist;

    for (let i in storage.keyBindings) {
      var item = storage.keyBindings[i];
      if (item.predefined) {
        //do predefined ones because their value needed for overlay
        // document.querySelector("#" + item["action"] + " .customDo").value = item["action"];
        updateCustomShortcutInputText(document.querySelector("#" + item["action"] + " .customKey"), item["key"]);
        document.querySelector("#" + item["action"] + " .customValue").value = item["value"];
        document.querySelector("#" + item["action"] + " .customForce").value = item["force"];
      }
      else {
        // new ones
        add_shortcut();
        const dom = document.querySelector(".customs:last-of-type")
        dom.querySelector(".customDo").value = item["action"];

        if (item["action"] === "pause" || item["action"] === "muted")
          dom.querySelector(".customValue").disabled = true;

        updateCustomShortcutInputText(dom.querySelector(".customKey"), item["key"]);
        dom.querySelector(".customValue").value = item["value"];
        dom.querySelector(".customForce").value = item["force"];
      }
    }
  });
}

function restore_defaults() {
  chrome.storage.sync.set(tcDefaults, function() {
    restore_options();
    document.querySelectorAll(".removeParent").forEach(button => button.click()); // Remove added shortcuts
    // Update status to let user know options were saved.
    var status = document.getElementById('status');
    status.textContent = 'Default options restored';
    setTimeout(function() {
      status.textContent = '';
    }, 1000);
  });
}

function show_experimental() {
  document.querySelectorAll(".customForce").forEach(item => item.style.display = 'inline-block');
}

function initShortcutInput(inputId) {
  document.getElementById(inputId).addEventListener('focus', inputFocus);
  document.getElementById(inputId).addEventListener('blur', inputBlur);
  document.getElementById(inputId).addEventListener('keydown', recordKeyPress);
}

document.addEventListener('DOMContentLoaded', function () {
  restore_options();

  document.getElementById('save').addEventListener('click', save_options);
  document.getElementById('add').addEventListener('click', add_shortcut);
  document.getElementById('restore').addEventListener('click', restore_defaults);
  document.getElementById('experimental').addEventListener('click', show_experimental);

  initShortcutInput('displayKeyInput');

  function eventCaller(event, className, funcName) {
    if (!event.target.classList.contains(className)) {
      return
    }
    funcName(event);
  }

  document.addEventListener('keypress', (event) => {
    eventCaller(event, "customValue", inputFilterNumbersOnly)
  });
  document.addEventListener('focus', (event) => {
    eventCaller(event, "customKey", inputFocus)
  });
  document.addEventListener('blur', (event) => {
    eventCaller(event, "customKey", inputBlur)
  });
  document.addEventListener('keydown', (event) => {
    eventCaller(event, "customKey", recordKeyPress)
  });
  document.addEventListener('click', (event) => {
    eventCaller(event, "removeParent", function () {
      event.target.parentNode.remove()
    })
  });
  document.addEventListener('change', (event) => {
    eventCaller(event, "customDo", function () {
      switch (event.target.value) {
        case "muted":
        case "pause":
          event.target.nextElementSibling.nextElementSibling.disabled = true;
          event.target.nextElementSibling.nextElementSibling.value = 0;
          break;
        default:
          event.target.nextElementSibling.nextElementSibling.disabled = false;
      }
    })
  });
})
