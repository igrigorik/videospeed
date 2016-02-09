var tcDefaults = {
  speed:              1.0,  // default 1x
  speedStep:          0.1,  // default 0.1x
  rewindTime:         10,   // default 10s
  advanceTime:        10,   // default 10s
  resetKeyCode:       82,   // default: R
  resetKeyCodeDupl:   1050, // default: К (Cyrillic)
  slowerKeyCode:      83,   // default: S
  slowerKeyCodeDupl:  1067, // default: В (Cyrillic)
  fasterKeyCode:      68,   // default: D
  fasterKeyCodeDupl:  1042, // default: Ы (Cyrillic)
  rewindKeyCode:      90,   // default: Z
  rewindKeyCodeDupl:  1071, // default: Я (Cyrillic)
  advanceKeyCode:     88,   // default: X
  advanceKeyCodeDupl: 1063, // default: Ч (Cyrillic)
  rememberSpeed:      false // default: false
};

function recordKeyPress(e) {
  var normalizedChar = String.fromCharCode(e.keyCode).toUpperCase();
  e.target.value = normalizedChar;
  e.target.keyCode = normalizedChar.charCodeAt();

  e.preventDefault();
  e.stopPropagation();
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
   e.target.value = String.fromCharCode(e.target.keyCode).toUpperCase();
};

function updateShortcutInputText(inputId, keyCode) {
  document.getElementById(inputId).value = String.fromCharCode(keyCode).toUpperCase();
  document.getElementById(inputId).keyCode = keyCode;
}

// Saves options to chrome.storage
function save_options() {

  var speedStep          = document.getElementById('speedStep').value;
  var rewindTime         = document.getElementById('rewindTime').value;
  var advanceTime        = document.getElementById('advanceTime').value;
  var resetKeyCode       = document.getElementById('resetKeyInput').keyCode;
  var resetKeyCodeDupl   = document.getElementById('resetKeyInputDupl').keyCode;
  var rewindKeyCode      = document.getElementById('rewindKeyInput').keyCode;
  var rewindKeyCodeDupl  = document.getElementById('rewindKeyInputDupl').keyCode;
  var advanceKeyCode     = document.getElementById('advanceKeyInput').keyCode;
  var advanceKeyCodeDupl = document.getElementById('advanceKeyInputDupl').keyCode;
  var slowerKeyCode      = document.getElementById('slowerKeyInput').keyCode;
  var slowerKeyCodeDupl  = document.getElementById('slowerKeyInputDupl').keyCode;
  var fasterKeyCode      = document.getElementById('fasterKeyInput').keyCode;
  var fasterKeyCodeDupl  = document.getElementById('fasterKeyInputDupl').keyCode;
  var rememberSpeed      = document.getElementById('rememberSpeed').checked;

  speedStep          = isNaN(speedStep)          ? tcDefaults.speedStep          : Number(speedStep);
  rewindTime         = isNaN(rewindTime)         ? tcDefaults.rewindTime         : Number(rewindTime);
  advanceTime        = isNaN(advanceTime)        ? tcDefaults.advanceTime        : Number(advanceTime);
  resetKeyCode       = isNaN(resetKeyCode)       ? tcDefaults.resetKeyCode       : resetKeyCode;
  resetKeyCodeDupl   = isNaN(resetKeyCodeDupl)   ? tcDefaults.resetKeyCodeDupl   : resetKeyCodeDupl;
  rewindKeyCode      = isNaN(rewindKeyCode)      ? tcDefaults.rewindKeyCode      : rewindKeyCode;
  rewindKeyCodeDupl  = isNaN(rewindKeyCodeDupl)  ? tcDefaults.rewindKeyCodeDupl  : rewindKeyCodeDupl;
  advanceKeyCode     = isNaN(advanceKeyCode)     ? tcDefaults.advanceKeyCode     : advanceKeyCode;
  advanceKeyCodeDupl = isNaN(advanceKeyCodeDupl) ? tcDefaults.advanceKeyCodeDupl : advanceKeyCodeDupl;
  slowerKeyCode      = isNaN(slowerKeyCode)      ? tcDefaults.slowerKeyCode      : slowerKeyCode;
  slowerKeyCodeDupl  = isNaN(slowerKeyCodeDupl)  ? tcDefaults.slowerKeyCodeDupl  : slowerKeyCodeDupl;
  fasterKeyCode      = isNaN(fasterKeyCode)      ? tcDefaults.fasterKeyCode      : fasterKeyCode;
  fasterKeyCodeDupl  = isNaN(fasterKeyCodeDupl)  ? tcDefaults.fasterKeyCodeDupl  : fasterKeyCodeDupl;

  chrome.storage.sync.set({
    speedStep:          speedStep,
    rewindTime:         rewindTime,
    advanceTime:        advanceTime,
    resetKeyCode:       resetKeyCode,
    resetKeyCodeDupl:   resetKeyCodeDupl,
    rewindKeyCode:      rewindKeyCode,
    rewindKeyCodeDupl:  rewindKeyCodeDupl,
    advanceKeyCode:     advanceKeyCode,
    advanceKeyCodeDupl: advanceKeyCodeDupl,
    slowerKeyCode:      slowerKeyCode,
    slowerKeyCodeDupl:  slowerKeyCodeDupl,
    fasterKeyCode:      fasterKeyCode,
    fasterKeyCodeDupl:  fasterKeyCodeDupl,
    rememberSpeed:      rememberSpeed
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
    document.getElementById('speedStep').value = storage.speedStep.toFixed(2);
    document.getElementById('rewindTime').value = storage.rewindTime;
    document.getElementById('advanceTime').value = storage.advanceTime;
    updateShortcutInputText('resetKeyInput', storage.resetKeyCode);
    updateShortcutInputText('resetKeyInputDupl', storage.resetKeyCodeDupl);
    updateShortcutInputText('rewindKeyInput', storage.rewindKeyCode);
    updateShortcutInputText('rewindKeyInputDupl', storage.rewindKeyCodeDupl);
    updateShortcutInputText('advanceKeyInput', storage.advanceKeyCode);
    updateShortcutInputText('advanceKeyInputDupl', storage.advanceKeyCodeDupl);
    updateShortcutInputText('slowerKeyInput', storage.slowerKeyCode);
    updateShortcutInputText('slowerKeyInputDupl', storage.slowerKeyCodeDupl);
    updateShortcutInputText('fasterKeyInput', storage.fasterKeyCode);
    updateShortcutInputText('fasterKeyInputDupl', storage.fasterKeyCodeDupl);
    document.getElementById('rememberSpeed').checked = storage.rememberSpeed;
  });
}

function restore_defaults() {
  chrome.storage.sync.set(tcDefaults, function() {
    restore_options();
    // Update status to let user know options were saved.
    var status = document.getElementById('status');
    status.textContent = 'Default options restored';
    setTimeout(function() {
      status.textContent = '';
    }, 1000);
  });
}

function initShortcutInput(inputId) {
  document.getElementById(inputId).addEventListener('focus', inputFocus);
  document.getElementById(inputId).addEventListener('blur', inputBlur);
  document.getElementById(inputId).addEventListener('keypress', recordKeyPress);
}

document.addEventListener('DOMContentLoaded', function () {
  restore_options();

  document.getElementById('save').addEventListener('click', save_options);
  document.getElementById('restore').addEventListener('click', restore_defaults);

  initShortcutInput('resetKeyInput');
  initShortcutInput('resetKeyInputDupl');
  initShortcutInput('rewindKeyInput');
  initShortcutInput('rewindKeyInputDupl');
  initShortcutInput('advanceKeyInput');
  initShortcutInput('advanceKeyInputDupl');
  initShortcutInput('slowerKeyInput');
  initShortcutInput('slowerKeyInputDupl');
  initShortcutInput('fasterKeyInput');
  initShortcutInput('fasterKeyInputDupl');

  document.getElementById('rewindTime').addEventListener('keypress', inputFilterNumbersOnly);
  document.getElementById('advanceTime').addEventListener('keypress', inputFilterNumbersOnly);
  document.getElementById('speedStep').addEventListener('keypress', inputFilterNumbersOnly);
})
