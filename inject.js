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
  });

  function defineVideoController() {
    tc.videoController = function(target, parent) {
      this.video = target;
      this.parent = target.parentElement || parent;
      this.document = target.ownerDocument;
      this.id = Math.random().toString(36).substr(2, 9);
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
      var document = this.document;
      var speed = parseFloat(tc.settings.speed).toFixed(2),
        top = Math.max(this.video.offsetTop, 0) + "px",
        left = Math.max(this.video.offsetLeft, 0) + "px";

      var prevent = function(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      var wrapper = document.createElement('div');
      wrapper.classList.add('vsc-controller');
      wrapper.dataset['vscid'] = this.id;
      wrapper.addEventListener('dblclick', prevent, true);
      wrapper.addEventListener('mousedown', prevent, true);
      wrapper.addEventListener('click', prevent, true);

      var shadow = wrapper.createShadowRoot();
      var shadowTemplate = `
        <style>
          @import "${chrome.extension.getURL('shadow.css')}";
        </style>

        <div id="controller" style="top:${top}; left:${left}">
          <span>${speed}</span>
          <span id="controls">
            <button data-action="rewind" class="rw">«</button>
            <button data-action="slower">-</button>
            <button data-action="faster">+</button>
            <button data-action="advance" class="rw">»</button>
            <button data-action="close" class="hideButton">x</button>
          </span>
        </div>
      `;
      shadow.innerHTML = shadowTemplate;
      shadow.querySelectorAll('button').forEach(button => {
        button.onclick = (e) => {
          runAction(e.target.dataset['action'], document);
        }
      });

      this.speedIndicator = shadow.querySelector('span');
      var fragment = document.createDocumentFragment();
      fragment.appendChild(wrapper);

      // Note: when triggered via a MutationRecord, it's possible that the
      // target is not the immediate parent. This appends the controller as
      // the first element of the target, which may not be the parent.
      this.parent.insertBefore(fragment, this.parent.firstChild);
      this.video.classList.add('vsc-initialized');
      this.video.dataset['vscid'] = this.id;
    }
  }

  function initializeWhenReady(document) {
    var readyStateCheckInterval = setInterval(function() {
      if (document.readyState === 'complete') {
        clearInterval(readyStateCheckInterval);
        initializeNow(document);
      }
    }, 10);
  }

  function initializeNow(document) {
      if (document === window.document) {
        defineVideoController();
      } else {
        var link = document.createElement('link');
        link.href = chrome.extension.getURL('inject.css');
        link.type = 'text/css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }

      document.addEventListener('keydown', function(event) {
        var keyCode = event.keyCode;

        // Ignore keydown event if typing in an input box
        if ((document.activeElement.nodeName === 'INPUT'
              && document.activeElement.getAttribute('type') === 'text')
            || document.activeElement.isContentEditable) {
          return false;
        }

        if (keyCode == tc.settings.rewindKeyCode) {
          runAction('rewind', document, true)
        } else if (keyCode == tc.settings.advanceKeyCode) {
          runAction('advance', document, true)
        } else if (keyCode == tc.settings.fasterKeyCode) {
          runAction('faster', document, true)
        } else if (keyCode == tc.settings.slowerKeyCode) {
          runAction('slower', document, true)
        } else if (keyCode == tc.settings.resetKeyCode) {
          runAction('reset', document, true)
        }

        return false;
      }, true);

      var forEach = Array.prototype.forEach;
      function checkForVideo(node, parent) {
        if (node.nodeName === 'VIDEO') {
          if (!node.classList.contains('vsc-initialized')) {
            new tc.videoController(node, parent);
          }
        } else if (node.children != undefined) {
          for (var i = 0; i < node.children.length; i++) {
            checkForVideo(node.children[i],
                          node.children[i].parentNode || parent);
          }
        }
      }
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          forEach.call(mutation.addedNodes, function(node) {
            checkForVideo(node, node.parentNode || mutation.target);
          })
        });
      });
      observer.observe(document, { childList: true, subtree: true });

      var videoTags = document.getElementsByTagName('video');
      forEach.call(videoTags, function(video) {
        new tc.videoController(video);
      });

      var frameTags = document.getElementsByTagName('iframe');
      forEach.call(frameTags, function(frame) {
        // Ignore frames we don't have permission to access (different origin).
        try { var childDocument = frame.contentDocument } catch (e) { return }
        initializeWhenReady(childDocument);
      });
  }

  function runAction(action, document, keyboard = false) {
    var videoTags = document.getElementsByTagName('video');
    videoTags.forEach = Array.prototype.forEach;

    videoTags.forEach(function(v) {
      var id = v.dataset['vscid'];
      var controller = document.querySelector(`div[data-vscid="${id}"]`)
        .shadowRoot.querySelector('#controller');

      if (keyboard)
        showController(controller);

      if (!v.classList.contains('vsc-cancelled')) {
        if (action === 'rewind') {
          v.currentTime -= tc.settings.rewindTime;
        } else if (action === 'advance') {
          v.currentTime += tc.settings.advanceTime;
        } else if (action === 'faster') {
          // Maximum playback speed in Chrome is set to 16:
          // https://code.google.com/p/chromium/codesearch#chromium/src/media/blink/webmediaplayer_impl.cc&l=64
          var s = Math.min(v.playbackRate + tc.settings.speedStep, 16);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'slower') {
          // Audio playback is cut at 0.05:
          // https://code.google.com/p/chromium/codesearch#chromium/src/media/filters/audio_renderer_algorithm.cc&l=49
          var s = Math.max(v.playbackRate - tc.settings.speedStep, 0);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'reset') {
          v.playbackRate = 1.0;
        } else if (action === 'close') {
          v.classList.add('vsc-cancelled');
          controller.remove();
        }
      }
    });
  }

  function showController(controller) {
    controller.style.visibility = 'visible';
    if (controllerAnimation != null
        && controllerAnimation.playState != 'finished') {
      controllerAnimation.cancel();
    }

    // TODO : if controller is visible, do not start animation.
    controllerAnimation = controller.animate([
      {opacity: 0.3},
      {opacity: 0.3},
      {opacity: 0.0},
    ], {
      duration: 2000,
      iterations: 1,
      delay: 0
    });
  }

  initializeWhenReady(document);
});
