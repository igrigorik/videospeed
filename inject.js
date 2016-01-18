chrome.extension.sendMessage({}, function(response) {

  var tc = {
    settings: {
      speed: 1.0,          // default 1x
      speedStep: 0.1,      // default 0.1x
      rewindTime: 10,      // default 10s
      advanceTime: 10,     // default 10s
      resetKeyCode:  82,   // default: R
      slowerKeyCode: 83,   // default: S
      fasterKeyCode: 68,   // default: D
      rewindKeyCode: 90,   // default: Z
      advanceKeyCode: 88,  // default: X
      rememberSpeed: false // default: false
    }
  };

  var controllerAnimation;
  var readyStateCheckInterval;
  chrome.storage.sync.get(tc.settings, function(storage) {
      tc.settings.speed = Number(storage.speed);
      tc.settings.speedStep = Number(storage.speedStep);
      tc.settings.rewindTime = Number(storage.rewindTime);
      tc.settings.advanceTime = Number(storage.advanceTime);
      tc.settings.resetKeyCode = Number(storage.resetKeyCode);
      tc.settings.rewindKeyCode = Number(storage.rewindKeyCode);
      tc.settings.slowerKeyCode = Number(storage.slowerKeyCode);
      tc.settings.fasterKeyCode = Number(storage.fasterKeyCode);
      tc.settings.advanceKeyCode = Number(storage.advanceKeyCode);
      tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);

      readyStateCheckInterval = setInterval(initializeVideoSpeed, 10);
    }
  );

  function initializeVideoSpeed() {
    if (document.readyState === 'complete') {
      clearInterval(readyStateCheckInterval);

      tc.videoController = function(target) {
        this.video = target;
        if (!tc.settings.rememberSpeed) {
          tc.settings.speed = 1.0;
        }
        this.initializeControls();

        target.addEventListener('play', function(event) {
          target.playbackRate = tc.settings.speed;
        });

        target.addEventListener('ratechange', function(event) {
          if (target.readyState === 0) {
            return;
          }
          var speed = this.getSpeed();
          this.speedIndicator.textContent = speed;
          tc.settings.speed = speed;
          chrome.storage.sync.set({'speed': speed});
        }.bind(this));

        target.playbackRate = tc.settings.speed;
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
        var advanceButton = document.createElement('button');
        var hideButton = document.createElement('button');

        rewindButton.innerHTML = '&laquo;';
        fasterButton.textContent = '+';
        slowerButton.textContent = '-';
        advanceButton.innerHTML = '&raquo;';
        hideButton.textContent = 'x';
        hideButton.className = 'tc-hideButton';

        controls.appendChild(rewindButton);
        controls.appendChild(slowerButton);
        controls.appendChild(fasterButton);
        controls.appendChild(advanceButton);
        controls.appendChild(hideButton);

        container.appendChild(speedIndicator);
        container.appendChild(controls);

        container.classList.add('tc-videoController');
        controls.classList.add('tc-controls');

        fragment.appendChild(container);
        this.video.parentElement.insertBefore(fragment, this.video);

        var speed = parseFloat(tc.settings.speed).toFixed(2);
        speedIndicator.textContent = speed;
        this.speedIndicator = speedIndicator;

        container.addEventListener('click', function(e) {
          if (e.target === slowerButton) {
            runAction('slower')
          } else if (e.target === fasterButton) {
            runAction('faster')
          } else if (e.target === rewindButton) {
            runAction('rewind')
          } else if (e.target === advanceButton) {
            runAction('advance')
          } else if (e.target === hideButton) {
            container.nextSibling.classList.add('vc-cancelled')
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

      function setSpeed(v, speed) {
        v.playbackRate = speed;
      }

      function runAction(action) {
        var videoTags = document.getElementsByTagName('video');
        videoTags.forEach = Array.prototype.forEach;

        videoTags.forEach(function(v) {
          if (!v.classList.contains('vc-cancelled')) {
            if (action === 'rewind') {
              v.currentTime -= tc.settings.rewindTime;
            } else if (action === 'advance') {
              v.currentTime += tc.settings.advanceTime;
            } else if (action === 'faster') {
              // Maxium playback speed in Chrome is set to 16:
              // https://code.google.com/p/chromium/codesearch#chromium/src/media/blink/webmediaplayer_impl.cc&l=64
              var s = Math.min(v.playbackRate + tc.settings.speedStep, 16);
              setSpeed(v, Number(s.toFixed(2)));
            } else if (action === 'slower') {
              // Audio playback is cut at 0.05:
              // https://code.google.com/p/chromium/codesearch#chromium/src/media/filters/audio_renderer_algorithm.cc&l=49
              var s = Math.max(v.playbackRate - tc.settings.speedStep, 0);
              setSpeed(v, Number(s.toFixed(2)));
            } else if (action === 'reset') {
            	setSpeed(v, 1.0);
            }

            // show controller on keyboard input
            var controller = v.parentElement
              .getElementsByClassName('tc-videoController')[0];
            controller.style.visibility = 'visible';
            if (controllerAnimation != null
                && controllerAnimation.playState != 'finished') {
              controllerAnimation.cancel();
            }
            controllerAnimation = controller.animate([
              {opacity: 0.3},
              {opacity: 0.3},
              {opacity: 0.0},
            ], {
              duration: 3000,
              iterations: 1,
              delay: 0
            });
            controllerAnimation.onfinish = function(e) {
              controller.style.visibility = 'hidden';
            }
          }
        });
      }

      document.addEventListener('keypress', function(event) {
        // if lowercase letter pressed, check for uppercase key code
        var keyCode = String.fromCharCode(event.keyCode).toUpperCase().charCodeAt();

        // Ignore keypress event if typing in an input box
        if ((document.activeElement.nodeName === 'INPUT'
              && document.activeElement.getAttribute('type') === 'text')
            || document.activeElement.isContentEditable) {
          return false;
        }

        if (keyCode == tc.settings.rewindKeyCode) {
          runAction('rewind')
        } else if (keyCode == tc.settings.advanceKeyCode) {
          runAction('advance')
        } else if (keyCode == tc.settings.fasterKeyCode) {
          runAction('faster')
        } else if (keyCode == tc.settings.slowerKeyCode) {
          runAction('slower')
        } else if (keyCode == tc.settings.resetKeyCode) {
          runAction('reset')
        }

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
    }
  }
});
