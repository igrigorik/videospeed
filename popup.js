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
});
