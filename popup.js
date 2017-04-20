document.addEventListener('DOMContentLoaded', function () {
  document.querySelector('#config').addEventListener('click', function() {
    window.open(chrome.extension.getURL("options.html"));
  });
  
  document.querySelector('#about').addEventListener('click', function() {
    window.open("https://github.com/codebicycle/videospeed");
  });

  document.querySelector('#feedback').addEventListener('click', function() {
    window.open("https://github.com/codebicycle/videospeed/issues");
  });
});
