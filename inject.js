chrome.extension.sendMessage({}, function(response) {
  var tc = {
    settings: {
      speed: 1.0,           // default 1x
      resetSpeed: 1.0,      // default 1x
      speedStep: 0.1,       // default 0.1x
      fastSpeed: 1.8,       // default 1.8x
      rewindTime: 10,       // default 10s
      advanceTime: 10,      // default 10s
      resetKeyCode:  82,    // default: R
      slowerKeyCode: 83,    // default: S
      fasterKeyCode: 68,    // default: D
      rewindKeyCode: 90,    // default: Z
      advanceKeyCode: 88,   // default: X
      displayKeyCode: 86,   // default: V
      fastKeyCode: 71,      // default: G
      rememberSpeed: false, // default: false
      startHidden: false,   // default: false
      blacklist: `
        www.instagram.com
        twitter.com
        vine.co
        imgur.com
      `.replace(/^\s+|\s+$/gm,'')
    }
  };

  chrome.storage.sync.get(tc.settings, function(storage) {
    tc.settings.speed = Number(storage.speed);
    tc.settings.resetSpeed = Number(storage.resetSpeed);
    tc.settings.speedStep = Number(storage.speedStep);
    tc.settings.fastSpeed = Number(storage.fastSpeed);
    tc.settings.rewindTime = Number(storage.rewindTime);
    tc.settings.advanceTime = Number(storage.advanceTime);
    tc.settings.resetKeyCode = Number(storage.resetKeyCode);
    tc.settings.rewindKeyCode = Number(storage.rewindKeyCode);
    tc.settings.slowerKeyCode = Number(storage.slowerKeyCode);
    tc.settings.fasterKeyCode = Number(storage.fasterKeyCode);
    tc.settings.fastKeyCode = Number(storage.fastKeyCode);
    tc.settings.displayKeyCode = Number(storage.displayKeyCode);
    tc.settings.advanceKeyCode = Number(storage.advanceKeyCode);
    tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
    tc.settings.startHidden = Boolean(storage.startHidden);
    tc.settings.blacklist = String(storage.blacklist);

    initializeWhenReady(document);
  });

  var forEach = Array.prototype.forEach;

  function defineVideoController() {
    tc.videoController = function(target, parent) {
      if (target.dataset['vscid']) {
        return;
      }

      this.video = target;
      this.parent = target.parentElement || parent;
      this.document = target.ownerDocument;
      this.id = Math.random().toString(36).substr(2, 9);
      if (!tc.settings.rememberSpeed) {
        tc.settings.speed = 1.0;
        tc.settings.resetSpeed = tc.settings.fastSpeed;
      }
      this.initializeControls();

      target.addEventListener('play', function(event) {
        target.playbackRate = tc.settings.speed;
      });

      target.addEventListener('ratechange', function(event) {
        // Ignore ratechange events on unitialized videos.
        // 0 == No information is available about the media resource.
        if (event.target.readyState > 0) {
          var speed = this.getSpeed();
          this.speedIndicator.textContent = speed;
          tc.settings.speed = speed;
          chrome.storage.sync.set({'speed': speed}, function() {
            console.log('Speed setting saved: ' + speed);
          });
        }
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

      if (tc.settings.startHidden) {
        wrapper.classList.add('vsc-hidden');
      }

      var shadow = wrapper.createShadowRoot();
      var shadowTemplate = `
        <style>
          @import "${chrome.extension.getURL('shadow.css')}";
        </style>

        <div id="controller" style="top:${top}; left:${left}">
          <span data-action="drag" class="draggable">${speed}</span>
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
      shadow.querySelector('.draggable').addEventListener('mousedown', (e) => {
        runAction(e.target.dataset['action'], document);
      });

      forEach.call(shadow.querySelectorAll('button'), function(button) {
        button.onclick = (e) => {
          runAction(e.target.dataset['action'], document);
        }
      });

      this.speedIndicator = shadow.querySelector('span');
      var fragment = document.createDocumentFragment();
      fragment.appendChild(wrapper);

      this.video.classList.add('vsc-initialized');
      this.video.dataset['vscid'] = this.id;

      switch (true) {
        case (location.hostname == 'www.amazon.com'):
        case (/www\.hbogo\./).test(location.hostname):
          // insert before parent to bypass overlay
          this.parent.parentElement.insertBefore(fragment, this.parent);
          break;

        case (location.hostname == 'www.facebook.com'):
          // set stacking context to same as parent's parent.
          // + default fallthrough
          this.parent.style.zIndex = 'auto';

        default:
          // Note: when triggered via a MutationRecord, it's possible that the
          // target is not the immediate parent. This appends the controller as
          // the first element of the target, which may not be the parent.
          this.parent.insertBefore(fragment, this.parent.firstChild);
      }
    }
  }

  function initializeWhenReady(document) {
    escapeStringRegExp.matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
    function escapeStringRegExp(str) {
      return str.replace(escapeStringRegExp.matchOperatorsRe, '\\$&');
    }

    var blacklisted = false;
    tc.settings.blacklist.split("\n").forEach(match => {
      match = match.replace(/^\s+|\s+$/g,'')
      if (match.length == 0) {
        return;
      }

      var regexp = new RegExp(escapeStringRegExp(match));
      if (regexp.test(location.href)) {
        blacklisted = true;
        return;
      }
    })

    if (blacklisted)
      return;

    var readyStateCheckInterval = setInterval(function() {
      if (document && document.readyState === 'complete') {
        clearInterval(readyStateCheckInterval);
        initializeNow(document);
      }
    }, 10);
  }

  function initializeNow(document) {
      // in theory, this should only run once, in practice..
      // that's not guaranteed, hence we enforce own init-once.
      if (document.body.classList.contains('vsc-initialized')) {
        return;
      }
      document.body.classList.add('vsc-initialized');

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

        // Ignore if following modifier is active.
        if (!event.getModifierState
            || event.getModifierState("Alt")
            || event.getModifierState("Control")
            || event.getModifierState("Fn")
            || event.getModifierState("Meta")
            || event.getModifierState("Hyper")
            || event.getModifierState("OS")) {
          return;
        }

        // Ignore keydown event if typing in an input box
        if ((document.activeElement.nodeName === 'INPUT'
              && document.activeElement.getAttribute('type') === 'text')
            || document.activeElement.nodeName === 'TEXTAREA'
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
        } else if (keyCode == tc.settings.displayKeyCode) {
          runAction('display', document, true)
        } else if (keyCode == tc.settings.fastKeyCode) {
          runAction('fast', document, true);
        }

        return false;
      }, true);

      function checkForVideo(node, parent, added) {
        if (node.nodeName === 'VIDEO') {
          if (added) {
            new tc.videoController(node, parent);
          } else {
            if (node.classList.contains('vsc-initialized')) {
              let id = node.dataset['vscid'];
              let ctrl = document.querySelector(`div[data-vscid="${id}"]`)
              if (ctrl) {
                node.classList.remove('vsc-initialized');
                delete node.dataset['vscid'];
                ctrl.remove();
              }
            }
          }
        } else if (node.children != undefined) {
          for (var i = 0; i < node.children.length; i++) {
            checkForVideo(node.children[i],
                          node.children[i].parentNode || parent,
                          added);
          }
        }
      }
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          forEach.call(mutation.addedNodes, function(node) {
            if (typeof node === "function")
              return;
            checkForVideo(node, node.parentNode || mutation.target, true);
          })
          forEach.call(mutation.removedNodes, function(node) {
            if (typeof node === "function")
              return;
            checkForVideo(node, node.parentNode || mutation.target, false);
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

  function runAction(action, document, keyboard) {
    var videoTags = document.getElementsByTagName('video');
    videoTags.forEach = Array.prototype.forEach;

    videoTags.forEach(function(v) {
      var id = v.dataset['vscid'];
      var controller = document.querySelector(`div[data-vscid="${id}"]`);

      showController(controller);

      if (!v.classList.contains('vsc-cancelled')) {
        if (action === 'rewind') {
          v.currentTime -= tc.settings.rewindTime;
        } else if (action === 'advance') {
          v.currentTime += tc.settings.advanceTime;
        } else if (action === 'faster') {
          // Maximum playback speed in Chrome is set to 16:
          // https://cs.chromium.org/chromium/src/media/blink/webmediaplayer_impl.cc?l=103
          var s = Math.min( (v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + tc.settings.speedStep, 16);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'slower') {
          // Audio playback is cut at 0.05:
          // https://cs.chromium.org/chromium/src/media/filters/audio_renderer_algorithm.cc?l=49
          // Video min rate is 0.0625:
          // https://cs.chromium.org/chromium/src/media/blink/webmediaplayer_impl.cc?l=102
          var s = Math.max(v.playbackRate - tc.settings.speedStep, 0.0625);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'reset') {
          resetSpeed(v, 1.0);
        } else if (action === 'close') {
          v.classList.add('vsc-cancelled');
          controller.remove();
        } else if (action === 'display') {
          controller.classList.add('vsc-manual');
          controller.classList.toggle('vsc-hidden');
        } else if (action === 'drag') {
          handleDrag(v, controller);
        } else if (action === 'fast') {
          resetSpeed(v, tc.settings.fastSpeed);
        }
      }
    });
  }

  function resetSpeed(v, target) {
    if (v.playbackRate === target) {
      v.playbackRate = tc.settings.resetSpeed;
    } else {
      tc.settings.resetSpeed = v.playbackRate;
      chrome.storage.sync.set({'resetSpeed': v.playbackRate});
      v.playbackRate = target;
    }
  }

 function handleDrag(video, controller) {
    const parentElement = controller.parentElement,
      shadowController = controller.shadowRoot.querySelector('#controller');

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const startDragging = (e) => {
      let style = shadowController.style;
      style.left = parseInt(style.left) + e.movementX + 'px';
      style.top  = parseInt(style.top)  + e.movementY + 'px';
    }

    const stopDragging = () => {
      parentElement.removeEventListener('mousemove', startDragging);
      parentElement.removeEventListener('mouseup', stopDragging);
      parentElement.removeEventListener('mouseleave', stopDragging);

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');
    }

    parentElement.addEventListener('mouseup',stopDragging);
    parentElement.addEventListener('mouseleave',stopDragging);
    parentElement.addEventListener('mousemove', startDragging);
  }

  var timer;
  var animation = false;
  function showController(controller) {
    controller.classList.add('vcs-show');

    if (animation)
      clearTimeout(timer);

    animation = true;
    timer = setTimeout(function() {
      controller.classList.remove('vcs-show');
      animation = false;
    }, 2000);
  }
});
