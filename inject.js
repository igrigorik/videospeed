chrome.extension.sendMessage({}, function(response) {
  var readyStateCheckInterval = setInterval(function() {
    if (document.readyState === "complete") {
      clearInterval(readyStateCheckInterval);

      var tc = tc || {};
      tc.videoController = function(target) {
        this.video = target;
        this.initializeControls();

        chrome.storage.sync.get({
          speed: '1.00',
          rememberSpeed: false
        }, function(storage) {
          var speed = storage.rememberSpeed ? storage.speed : '1.00';
          target.playbackRate = speed;
          this.speedIndicator.textContent = speed;
        }.bind(this));

        this.video.addEventListener('ratechange', function(event) {
          var speed = this.getSpeed();
          this.speedIndicator.textContent = speed;
          chrome.storage.sync.set({'speed': speed});
        }.bind(this));
      };

      tc.videoController.prototype.getSpeed = function() {
        return parseFloat(this.video.playbackRate).toFixed(2);
      }

      tc.videoController.prototype.remove = function() {
        this.parentElement.removeChild(this);
      }

      tc.videoController.prototype.initializeControls = function() {
        var fragment = document.createDocumentFragment();
        var container = document.createElement('div');
        var speedIndicator = document.createElement('span');

        var controls = document.createElement('span');
        var fasterButton = document.createElement('button');
        var slowerButton = document.createElement('button');
        var rewindButton = document.createElement('button');

        rewindButton.innerHTML = '&laquo;';
        fasterButton.textContent = '+';
        slowerButton.textContent = '-';

        controls.appendChild(rewindButton);
        controls.appendChild(slowerButton);
        controls.appendChild(fasterButton);

        container.appendChild(speedIndicator);
        container.appendChild(controls);

        container.classList.add('tc-videoController');
        controls.classList.add('tc-controls');

        fragment.appendChild(container);
        this.video.parentElement.insertBefore(fragment, this.video);
        this.video.classList.add('tc-videoHost');

        this.speedIndicator = speedIndicator;

        container.addEventListener('click', function(e) {
          if      (e.target === slowerButton) { runAction('slower') }
          else if (e.target === fasterButton) { runAction('faster') }
          else if (e.target === rewindButton) { runAction('rewind') }
          else {
            container.nextSibling.classList.add("vc-cancelled")
            container.remove();
          }

          e.preventDefault();
          e.stopPropagation();
        }, true);

        // Prevent full screen mode on YouTube
        container.addEventListener('dblclick', function(e) {
          e.preventDefault();
          e.stopPropagation();
        }, true);

        // Prevent full screen mode on Vimeo
        container.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
        }, true);        
      }

      function runAction(action) {
        var videoTags = document.getElementsByTagName('video');
        videoTags.forEach = Array.prototype.forEach;

        videoTags.forEach(function(v) {
          if (!v.paused && !v.classList.contains("vc-cancelled")) {
            if (action === 'rewind') {
              v.playbackRate -= speedStep;
              v.currentTime -= rewindTime;
            } else if (action === 'faster') { 
                v.playbackRate += speedStep }
              else if (action === 'slower') { 
                  v.playbackRate = Math.max(v.playbackRate - speedStep, 0.00) }
          }
        });
      }

      document.addEventListener('keypress', function(event) {
        
        // if lowercase letter pressed, check for uppercase key code
        var keyCode = String.fromCharCode(event.keyCode).toUpperCase().charCodeAt();

        if      (keyCode == rewindKeyCode) { runAction('rewind') }
        else if (keyCode == fasterKeyCode) { runAction('faster') } 
        else if (keyCode == slowerKeyCode) { runAction('slower') }

        return false;
      }, true);

      document.addEventListener('DOMNodeInserted', function(event) {
        var node = event.target || null;
        if (node && node.nodeName === 'VIDEO') {
          new tc.videoController(node);
        }
      });

      var videoTags = document.getElementsByTagName('video');
      videoTags.forEach = Array.prototype.forEach;
      videoTags.forEach(function(video) {
        var control = new tc.videoController(video);
      });
        
      var speedStep, rewindTime, rewindKeyCode, slowerKeyCode, fasterKeyCode;
      
      chrome.storage.sync.get({ 
        speedStep:        0.1, // default 0.10x
        rewindTime:       10,   // default 10s
          rewindKeyCode:  65,   // default: A
          slowerKeyCode:  83,   // default: S
          fasterKeyCode:  68    // default: D
        },              
        function(storage) { 
          speedStep     = Number(storage.speedStep);
          rewindTime    = Number(storage.rewindTime);
          rewindKeyCode = Number(storage.rewindKeyCode);
          slowerKeyCode = Number(storage.slowerKeyCode);
          fasterKeyCode = Number(storage.fasterKeyCode);
      });                     
    }
  }, 10);
});
