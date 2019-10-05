document.addEventListener('DOMContentLoaded', function () {
  document.querySelector('#config').addEventListener('click', function() {
    window.open(chrome.runtime.getURL("options.html"));
  });
  
  document.querySelector('#about').addEventListener('click', function() {
    window.open("https://github.com/igrigorik/videospeed");
  });

  document.querySelector('#feedback').addEventListener('click', function() {
    window.open("https://github.com/igrigorik/videospeed/issues");
  });

  document.querySelector('#enable').addEventListener('click', function() {
      toggleEnabled(true, settingsSavedReloadMessage);
  });

  document.querySelector('#disable').addEventListener('click', function() {
      toggleEnabled(false, settingsSavedReloadMessage);
  });

  chrome.storage.sync.get({enabled: true}, function(storage) {
    toggleEnabledUI(storage.enabled);
  });

  function toggleEnabled(enabled, callback){
    chrome.storage.sync.set({
      enabled: enabled,
    }, function() {
      toggleEnabledUI(enabled);
      if(callback) callback(enabled);
    });
  }

  function toggleEnabledUI(enabled){
    document.querySelector('#enable').classList.toggle("hide", enabled);
    document.querySelector('#disable').classList.toggle("hide", !enabled);
  }

  function settingsSavedReloadMessage(){
    setStatusMessage("Saved. Reload page to see changes");
  }

  function setStatusMessage(str){
    const status_element = document.querySelector('#status')
    status_element.classList.toggle("hide", false);
    status_element.innerText = str;
  }
});
