var tcDefaults = {
  speed: 1.0,           // default:
  displayKeyCode: 86,   // default: V
  rememberSpeed: false, // default: false
  startHidden: false,   // default: false
  keyBindings: [
    ["slower", 83, 0.1, 0], // default: S 0.1
    ["faster", 68, 0.1, 0], // default: D 0.1
    ["rewind", 90, 10, 0], // default: Z 0.1
    ["advance", 88, 10, 0], // default: X 0.1
    ["reset", 82, 1, 0], // default: R 1
    ["fast", 71, 1.8, 0] // default: G 1.8
  ],
  version: "0.5.3",     // default: 0.5.3
  blacklist: `
    www.instagram.com
    twitter.com
    vine.co
    imgur.com
  `.replace(/^\s+|\s+$/gm, '')
};

var keyBindings = []; // whattodo-keyCode-value-force

var keyCodeAliases = {
  0: 'null',
  null: 'null',
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
  var html = '<select class="customDo">' +
    '<option value="slower">Decrease speed</option>' +
    '<option value="faster">Increase speed</option>' +
    '<option value="rewind">Rewind</option>' +
    '<option value="advance">Advance</option>' +
    // '<option value="reset">Reset speed</option>' +
    '<option value="fast">Preferred speed</option>' +
    '<option value="muted">Muted</option>' +
    '<option value="fast">Pause</option>' +
    '</select> ' +
    '<input class="customKey" type="text" placeholder="press a key"/> ' +
    '<input class="customValue" type="text" placeholder="value (0.10)"/> ' +
    '<select class="customReturn">' +
    '<option value="0">Do not disable website key bindings</option>' +
    '<option value="1">Disable websites key bindings</option>' +
    '</select>' +
    '<button class="removeParent">X</button>';
  var div = document.createElement('div');
  div.setAttribute('class', 'row customs');
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(div, customs_element.children[customs_element.childElementCount - 1]);
}

function createKeyBindings() {
  var doo = $(this).find(".customDo").val();
  var key = $(this).find(".customKey")[0].keyCode;
  var val = Number($(this).find(".customValue").val());
  var ret = Number($(this).find(".customReturn").val());

  keyBindings.push([doo, key, val, ret]);
}

// Saves options to chrome.storage
function save_options() {
  keyBindings = [];
  $(".customs").each(createKeyBindings)

  var displayKeyCode = document.getElementById('displayKeyInput').keyCode;
  var rememberSpeed = document.getElementById('rememberSpeed').checked;
  var startHidden = document.getElementById('startHidden').checked;
  var blacklist = document.getElementById('blacklist').value;
  var version = tcDefaults.version;

  displayKeyCode = isNaN(displayKeyCode) ? tcDefaults.displayKeyCode : displayKeyCode;

  chrome.storage.sync.clear();
  chrome.storage.sync.set({
    displayKeyCode: displayKeyCode,
    rememberSpeed: rememberSpeed,
    startHidden: startHidden,
    keyBindings: keyBindings,
    version: version,
    blacklist: blacklist.replace(/^\s+|\s+$/gm, '')
  }, function () {
    // Update status to let user know options were saved.
    var status = document.getElementById('status');
    status.textContent = 'Options saved';
    setTimeout(function () {
      status.textContent = '';
    }, 1000);
  });
}

// Restores options from chrome.storage
function restore_options() {
  chrome.storage.sync.get(tcDefaults, function (storage) {
    updateShortcutInputText('displayKeyInput', storage.displayKeyCode);
    document.getElementById('rememberSpeed').checked = storage.rememberSpeed;
    document.getElementById('startHidden').checked = storage.startHidden;
    document.getElementById('blacklist').value = storage.blacklist;

    for (let i in storage.keyBindings) {
      var item = storage.keyBindings[i];
      if (i < 6) {
        //do pre-defined ones because their value needed for overlay
        $(".customDo").get(i).value = item[0]
        updateCustomShortcutInputText($(".customKey").get(i), item[1]);
        $(".customValue").get(i).value = item[2]
        $(".customReturn").get(i).value = item[3]
      }
      else {
        // new ones
        add_shortcut();

        $(".customDo")[i].value = item[0];

        if (item[0] == "fast" && item[2] == 0.0) // Pause
        {
          $(".customDo").eq(i).children().last().attr("selected", "selected");
          $(".customValue").eq(i).attr("disabled", true);
        }
        else if (item[0] == "muted") // Muted
          $(".customValue").eq(i).attr("disabled", true);
        updateCustomShortcutInputText($(".customKey")[i], item[1]);
        $(".customValue")[i].value = item[2];
        $(".customReturn")[i].value = item[3];
      }
      console.log(storage.keyBindings[i]);
    }
  });
}

function restore_defaults() {
  chrome.storage.sync.set(tcDefaults, function () {
    restore_options();
    $(".removeParent").click(); // Remove added shortcuts
    // Update status to let user know options were saved.
    var status = document.getElementById('status');
    status.textContent = 'Default options restored';
    setTimeout(function () {
      status.textContent = '';
    }, 1000);
  });
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

  initShortcutInput('displayKeyInput');

  $(document).on("keypress", ".customValue", inputFilterNumbersOnly);
  $(document).on("focus", ".customKey", inputFocus);
  $(document).on("blur", ".customKey", inputBlur);
  $(document).on("keydown", ".customKey", recordKeyPress);
  $(document).on("click", ".removeParent", function () {
    $(this).parent().remove()
  });
  $(document).on('change', '.customDo', function () {
    switch ($(this).find(":selected").text()) {
      case "Muted":
      case "Pause":
        $(this).next().next().attr("disabled", true).val("0.0");
        break;
      default:
        $(this).next().next().attr("disabled", false)
    }
  });
})
