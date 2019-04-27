  var tc = {
    settings: {
      lastSpeed: 1.0,       // default 1x
      speeds: {},           // empty object to hold speed for each source

      displayKeyCode: 86,   // default: V
      rememberSpeed: false, // default: false
      audioBoolean: false,  // default: false
      startHidden: false,   // default: false
      keyBindings: [],
      blacklist: `
        www.instagram.com
        twitter.com
        vine.co
        imgur.com
      `.replace(/^\s+|\s+$/gm,'')
    }
  };

  chrome.storage.sync.get(tc.settings, function (storage) {
    tc.settings.keyBindings = storage.keyBindings; // Array
    if (storage.keyBindings.length == 0) // if first initialization of 0.5.3
    {
      // UPDATE
      tc.settings.keyBindings.push({
        action: "slower",
        key: Number(storage.slowerKeyCode) || 83,
        value: Number(storage.speedStep) || 0.1,
        force: false,
        predefined: true
      }); // default S
      tc.settings.keyBindings.push({
        action: "faster",
        key: Number(storage.fasterKeyCode) || 68,
        value: Number(storage.speedStep) || 0.1,
        force: false,
        predefined: true
      }); // default: D
      tc.settings.keyBindings.push({
        action: "rewind",
        key: Number(storage.rewindKeyCode) || 90,
        value: Number(storage.rewindTime) || 10,
        force: false,
        predefined: true
      }); // default: Z
      tc.settings.keyBindings.push({
        action: "advance",
        key: Number(storage.advanceKeyCode) || 88,
        value: Number(storage.advanceTime) || 10,
        force: false,
        predefined: true
      }); // default: X
      tc.settings.keyBindings.push({
        action: "reset",
        key: Number(storage.resetKeyCode) || 82,
        value: 1.0,
        force: false,
        predefined: true
      }); // default: R
      tc.settings.keyBindings.push({
        action: "fast",
        key: Number(storage.fastKeyCode) || 71,
        value: Number(storage.fastSpeed) || 1.8,
        force: false,
        predefined: true
      }); // default: G
      tc.settings.version = "0.5.3";

      chrome.storage.sync.set({
        keyBindings: tc.settings.keyBindings,
        version: tc.settings.version,
        displayKeyCode: tc.settings.displayKeyCode,
        rememberSpeed: tc.settings.rememberSpeed,
        audioBoolean: tc.settings.audioBoolean,
        startHidden: tc.settings.startHidden,
        blacklist: tc.settings.blacklist.replace(/^\s+|\s+$/gm, '')
      });
    }
    tc.settings.lastSpeed = Number(storage.lastSpeed);
    tc.settings.displayKeyCode = Number(storage.displayKeyCode);
    tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
    tc.settings.audioBoolean = Boolean(storage.audioBoolean);
    tc.settings.startHidden = Boolean(storage.startHidden);
    tc.settings.blacklist = String(storage.blacklist);

    initializeWhenReady(document);
  });

  var forEach = Array.prototype.forEach;

  function getKeyBindings(action, what = "value") {
    try {
      return tc.settings.keyBindings.find(item => item.action === action)[what];
    } catch (e) {
      return false;
    }
  }

  function setKeyBindings(action, value) {
    tc.settings.keyBindings.find(item => item.action === action)["value"] = value;
  }

  function defineVideoController() {
    tc.videoController = function(target, parent) {
      if (target.dataset['vscid']) {
        return;
      }

      this.video = target;
      this.parent = target.parentElement || parent;
      this.document = target.ownerDocument;
      this.id = Math.random().toString(36).substr(2, 9);

      // settings.speeds[] ensures that same source used across video tags (e.g. fullscreen on YT) retains speed setting
      // this.speed is a controller level variable that retains speed setting across source switches (e.g. video quality, playlist change)
      this.speed = 1.0;

      if (!tc.settings.rememberSpeed) {
        if (!tc.settings.speeds[target.src]) {
          tc.settings.speeds[target.src] = this.speed;
        }
        setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
      } else {
        tc.settings.speeds[target.src] = tc.settings.lastSpeed;
      }
      this.initializeControls();

      target.addEventListener('play', function(event) {
        if (!tc.settings.rememberSpeed) {
          if (!tc.settings.speeds[target.src]) {
            tc.settings.speeds[target.src] = this.speed;
          }
          setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
        } else {
          tc.settings.speeds[target.src] = tc.settings.lastSpeed;
        }
        target.playbackRate = tc.settings.speeds[target.src];
      }.bind(this));

      target.addEventListener('ratechange', function(event) {
        // Ignore ratechange events on unitialized videos.
        // 0 == No information is available about the media resource.
        if (event.target.readyState > 0) {
          var speed = this.getSpeed();
          this.speedIndicator.textContent = speed;
          tc.settings.speeds[this.video.src] = speed;
          tc.settings.lastSpeed = speed;
          this.speed = speed;
          chrome.storage.sync.set({'lastSpeed': speed}, function() {
            console.log('Speed setting saved: ' + speed);
          });
        }
      }.bind(this));

      target.playbackRate = tc.settings.speeds[target.src];
    };

    tc.videoController.prototype.getSpeed = function() {
      return parseFloat(this.video.playbackRate).toFixed(2);
    }

    tc.videoController.prototype.remove = function() {
      this.parentElement.removeChild(this);
    }

    tc.videoController.prototype.initializeControls = function() {
      var document = this.document;
      var speed = parseFloat(tc.settings.speeds[this.video.src]).toFixed(2),
        top = Math.max(this.video.offsetTop, 0) + "px",
        left = Math.max(this.video.offsetLeft, 0) + "px";

      var wrapper = document.createElement('div');
      wrapper.classList.add('vsc-controller');
      wrapper.dataset['vscid'] = this.id;

      if (tc.settings.startHidden) {
        wrapper.classList.add('vsc-hidden');
      }

      var shadow = wrapper.attachShadow({ mode: 'open' });
      var shadowTemplate = `
        <style>
          @import "${chrome.runtime.getURL('shadow.css')}";
        </style>

        <div id="controller" style="top:${top}; left:${left}">
          <span data-action="drag" class="draggable">${speed}</span>
          <span id="controls">
            <button data-action="rewind" class="rw">«</button>
            <button data-action="slower">-</button>
            <button data-action="faster">+</button>
            <button data-action="advance" class="rw">»</button>
            <button data-action="display" class="hideButton">x</button>
          </span>
        </div>
      `;
      shadow.innerHTML = shadowTemplate;
      shadow.querySelector('.draggable').addEventListener('mousedown', (e) => {
        runAction(e.target.dataset['action'], document, false, e);
      });

      forEach.call(shadow.querySelectorAll('button'), function(button) {
        button.onclick = (e) => {
          runAction(e.target.dataset['action'], document, getKeyBindings(e.target.dataset['action']), e);
        }
      });

      this.speedIndicator = shadow.querySelector('span');
      var fragment = document.createDocumentFragment();
      fragment.appendChild(wrapper);

      this.video.dataset['vscid'] = this.id;

      switch (true) {
        case (location.hostname == 'www.amazon.com'):
        case (location.hostname == 'www.reddit.com'):
        case (/hbogo\./).test(location.hostname):
          // insert before parent to bypass overlay
          this.parent.parentElement.insertBefore(fragment, this.parent);
          break;

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

    window.onload = () => {
      initializeNow(window.document)
    };
    if (document) {
      if (document.readyState === "complete") {
        initializeNow(document);
      } else {
        document.onreadystatechange = () => {
          if (document.readyState === "complete") {
            initializeNow(document);
          }
        }
      }
    }
  }
  function inIframe () {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }
  function initializeNow(document) {
      // enforce init-once due to redundant callers
      if (!document.body || document.body.classList.contains('vsc-initialized')) {
        return;
      }
      document.body.classList.add('vsc-initialized');

      if (document === window.document) {
        defineVideoController();
      } else {
        var link = document.createElement('link');
        link.href = chrome.runtime.getURL('inject.css');
        link.type = 'text/css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      var docs = Array(document)
      try {
        if (inIframe())
          docs.push(window.top.document);
      } catch (e) {
      }

      docs.forEach(function(doc) {
        doc.addEventListener('keydown', function(event) {
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
          if (document.activeElement.nodeName === 'INPUT'
              || document.activeElement.nodeName === 'TEXTAREA'
              || document.activeElement.isContentEditable) {
            return false;
          }

          // Ignore keydown event if typing in a page without vsc
          if (!document.querySelector(".vsc-controller")) {
            return false;
          }

          if (keyCode == tc.settings.displayKeyCode) {
            runAction('display', document, true)
          }
        var item = tc.settings.keyBindings.find(item => item.key === keyCode);
        if (item) {
          runAction(item.action, document, item.value);
          if (item.force === "true") {// disable websites key bindings
            event.preventDefault();
            event.stopPropagation();
          }
        }

          return false;
        }, true);
      });


      function checkForVideo(node, parent, added) {
        if (node.nodeName === 'VIDEO' || (node.nodeName === 'AUDIO' && tc.settings.audioBoolean)) {
          if (added) {
            new tc.videoController(node, parent);
          } else {
            let id = node.dataset['vscid'];
            if (id) {
              let ctrl = document.querySelector(`div[data-vscid="${id}"]`)
              if (ctrl) {
                ctrl.remove();
              }
              delete node.dataset['vscid'];
            }
          }
        } else if (node.children != undefined) {
          for (var i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            checkForVideo(child, child.parentNode || parent, added);
          }
        }
      }

      var observer = new MutationObserver(function(mutations) {
        // Process the DOM nodes lazily
        requestIdleCallback(_ => {
          mutations.forEach(function(mutation) {
            forEach.call(mutation.addedNodes, function(node) {
              if (typeof node === "function")
                return;
              checkForVideo(node, node.parentNode || mutation.target, true);
            });
            forEach.call(mutation.removedNodes, function(node) {
              if (typeof node === "function")
                return;
              checkForVideo(node, node.parentNode || mutation.target, false);
            });
          });
        }, {timeout: 1000});
      });
      observer.observe(document, { childList: true, subtree: true });

      if (tc.settings.audioBoolean) {
        var mediaTags = document.querySelectorAll('video,audio');
      } else {
        var mediaTags = document.querySelectorAll('video');
      }
	  
      forEach.call(mediaTags, function(video) {
        new tc.videoController(video);
      });

      var frameTags = document.getElementsByTagName('iframe');
      forEach.call(frameTags, function(frame) {
        // Ignore frames we don't have permission to access (different origin).
        try { var childDocument = frame.contentDocument } catch (e) { return }
        initializeWhenReady(childDocument);
      });
  }

  function runAction(action, document, value, e) {
    if (tc.settings.audioBoolean) {
      var mediaTags = document.querySelectorAll('video,audio');
    } else {
      var mediaTags = document.querySelectorAll('video');
    }

    mediaTags.forEach = Array.prototype.forEach;

    // Get the controller that was used if called from a button press event e
    if (e) {
      var targetController = e.target.getRootNode().host;
    } 

    mediaTags.forEach(function(v) {
      var id = v.dataset['vscid'];
      var controller = document.querySelector(`div[data-vscid="${id}"]`);

      // Don't change video speed if the video has a different controller	
      if (e && !(targetController == controller)) {
        return;
      }

      // Controller may have been (force) removed by the site, guard to prevent crashes but run the command
      if (controller) {
        showController(controller);
      }

      if (!v.classList.contains('vsc-cancelled')) {
        if (action === 'rewind') {
          v.currentTime -= value;
        } else if (action === 'advance') {
          v.currentTime += value;
        } else if (action === 'faster') {
          // Maximum playback speed in Chrome is set to 16:
          // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=166
          var s = Math.min((v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + value, 16);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'slower') {
          // Video min rate is 0.0625:
          // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=165
          var s = Math.max(v.playbackRate - value, 0.07);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'reset') {
          resetSpeed(v, 1.0);
        } else if (action === 'display') {
          controller.classList.add('vsc-manual');
          controller.classList.toggle('vsc-hidden');
        } else if (action === 'drag') {
          handleDrag(v, controller, e);
        } else if (action === 'fast') {
          resetSpeed(v, value);
        } else if (action === 'pause') {
          pauseSpeed(v, value);
        } else if (action === 'muted') {
          muted(v, value);
        }
      }
    });
  }

  function pauseSpeed(v, target) {
    // not working as expected in youtube for now
    if (v.playbackRate === target) {
      v.play()
    }
    resetSpeed(v, target)
  }

  function resetSpeed(v, target) {
    if (v.playbackRate === target) {
      if (v.playbackRate === getKeyBindings("reset")) { // resetSpeed
        if (target !== 1.0) {
          v.playbackRate = 1.0;
        } else {
          v.playbackRate = getKeyBindings("fast");  // fastSpeed
        }
      } else {
        v.playbackRate = getKeyBindings("reset"); // resetSpeed
      }
    } else {
      setKeyBindings("reset", v.playbackRate);  // resetSpeed
      v.playbackRate = target;
    }
  }

  function muted(v, value) {
    v.muted = v.muted !== true;
  }

  function handleDrag(video, controller, e) {
    const shadowController = controller.shadowRoot.querySelector('#controller');

    // Find nearest parent of same size as video parent.
    var parentElement = controller.parentElement;
    while (parentElement.parentNode &&
      parentElement.parentNode.offsetHeight === parentElement.offsetHeight &&
      parentElement.parentNode.offsetWidth === parentElement.offsetWidth) {
      parentElement = parentElement.parentNode;
    }

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const initialMouseXY = [e.clientX, e.clientY];
    const initialControllerXY = [
      parseInt(shadowController.style.left),
      parseInt(shadowController.style.top)
    ];

    const startDragging = (e) => {
      let style = shadowController.style;
      let dx = e.clientX - initialMouseXY[0];
      let dy = e.clientY -initialMouseXY[1];
      style.left = (initialControllerXY[0] + dx) + 'px';
      style.top  = (initialControllerXY[1] + dy) + 'px';
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
