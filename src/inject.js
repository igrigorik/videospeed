var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var tc = {
  settings: {
    lastSpeed: 1.0, // default 1x
    enabled: true, // default enabled
    speeds: {}, // empty object to hold speed for each source

    displayKeyCode: 86, // default: V
    rememberSpeed: false, // default: false
    audioBoolean: false, // default: false
    startHidden: false, // default: false
    controllerOpacity: 0.3, // default: 0.3
    keyBindings: [],
    blacklist: `\
      www.instagram.com
      twitter.com
      vine.co
      imgur.com
      teams.microsoft.com
      `.replace(regStrip, "")
  }
};

chrome.storage.sync.get(tc.settings, function(storage) {
  tc.settings.keyBindings = storage.keyBindings; // Array
  if (storage.keyBindings.length == 0) {
    // if first initialization of 0.5.3
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
      enabled: tc.settings.enabled,
      controllerOpacity: tc.settings.controllerOpacity,
      blacklist: tc.settings.blacklist.replace(regStrip, "")
    });
  }
  tc.settings.lastSpeed = Number(storage.lastSpeed);
  tc.settings.displayKeyCode = Number(storage.displayKeyCode);
  tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
  tc.settings.audioBoolean = Boolean(storage.audioBoolean);
  tc.settings.enabled = Boolean(storage.enabled);
  tc.settings.startHidden = Boolean(storage.startHidden);
  tc.settings.controllerOpacity = Number(storage.controllerOpacity);
  tc.settings.blacklist = String(storage.blacklist);

  // ensure that there is a "display" binding (for upgrades from versions that had it as a separate binding)
  if (tc.settings.keyBindings.filter(x => x.action == "display").length == 0) {
    tc.settings.keyBindings.push({
      action: "display",
      key: Number(storage.displayKeyCode) || 86,
      value: 0,
      force: false,
      predefined: true
    }); // default V
  }

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
    if (target.dataset["vscid"]) {
      return target.vsc;
    }

    this.video = target;
    this.parent = target.parentElement || parent;
    this.document = target.ownerDocument;
    this.id = Math.random()
      .toString(36)
      .substr(2, 9);

    // settings.speeds[] ensures that same source used across video tags (e.g. fullscreen on YT) retains speed setting
    // this.speed is a controller level variable that retains speed setting across source switches (e.g. video quality, playlist change)
    this.speed = 1.0;

    if (!tc.settings.rememberSpeed) {
      if (!tc.settings.speeds[target.currentSrc]) {
        tc.settings.speeds[target.currentSrc] = this.speed;
      }
      setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
    } else {
      tc.settings.speeds[target.currentSrc] = tc.settings.lastSpeed;
    }

    target.playbackRate = tc.settings.speeds[target.currentSrc];

    this.div = this.initializeControls();

    target.addEventListener(
      "play",
      (this.handlePlay = function(event) {
        if (!tc.settings.rememberSpeed) {
          if (!tc.settings.speeds[target.currentSrc]) {
            tc.settings.speeds[target.currentSrc] = this.speed;
          }
          setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
        } else {
          tc.settings.speeds[target.currentSrc] = tc.settings.lastSpeed;
        }
        target.playbackRate = tc.settings.speeds[target.currentSrc];
      }.bind(this))
    );

    target.addEventListener(
      "ratechange",
      (this.handleRatechange = function(event) {
        // Ignore ratechange events on unitialized videos.
        // 0 == No information is available about the media resource.
        if (event.target.readyState > 0) {
          var speed = this.getSpeed();
          this.speedIndicator.textContent = speed;
          tc.settings.speeds[this.video.currentSrc] = speed;
          tc.settings.lastSpeed = speed;
          this.speed = speed;
          chrome.storage.sync.set({ lastSpeed: speed }, function() {
            console.log("Speed setting saved: " + speed);
          });
          // show the controller for 1000ms if it's hidden.
          runAction("blink", document, null, null);
        }
      }.bind(this))
    );

    var observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          var controller = getController(this.id);
          if (!controller) {
            return;
          }
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add("vsc-nosource");
          } else {
            controller.classList.remove("vsc-nosource");
          }
        }
      });
    });
    observer.observe(target, {
      attributeFilter: ["src", "currentSrc"]
    });
  };

  tc.videoController.prototype.getSpeed = function() {
    return parseFloat(this.video.playbackRate).toFixed(2);
  };

  tc.videoController.prototype.remove = function() {
    this.div.remove();
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("ratechange", this.handleRatechange);
    delete this.video.dataset["vscid"];
    delete this.video.vsc;
  };

  tc.videoController.prototype.initializeControls = function() {
    var document = this.document;
    var speed = parseFloat(tc.settings.speeds[this.video.currentSrc]).toFixed(
        2
      ),
      top = Math.max(this.video.offsetTop, 0) + "px",
      left = Math.max(this.video.offsetLeft, 0) + "px";

    var wrapper = document.createElement("div");
    wrapper.classList.add("vsc-controller");
    wrapper.dataset["vscid"] = this.id;

    if (!this.video.currentSrc) {
      wrapper.classList.add("vsc-nosource");
    }

    if (tc.settings.startHidden) {
      wrapper.classList.add("vsc-hidden");
    }

    var shadow = wrapper.attachShadow({ mode: "open" });
    var shadowTemplate = `
      <style>
        @import "${chrome.runtime.getURL("shadow.css")}";
      </style>

        <div id="controller" style="top:${top}; left:${left}; opacity:${
      tc.settings.controllerOpacity
    }">
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
    shadow.querySelector(".draggable").addEventListener("mousedown", e => {
      runAction(e.target.dataset["action"], document, false, e);
    });

    forEach.call(shadow.querySelectorAll("button"), function(button) {
      button.onclick = e => {
        runAction(
          e.target.dataset["action"],
          document,
          getKeyBindings(e.target.dataset["action"]),
          e
        );
      };
    });

    this.speedIndicator = shadow.querySelector("span");
    var fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    this.video.dataset["vscid"] = this.id;

    switch (true) {
      case location.hostname == "www.amazon.com":
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        // insert before parent to bypass overlay
        this.parent.parentElement.insertBefore(fragment, this.parent);
        break;
      case location.hostname == "tv.apple.com":
        // insert after parent for correct stacking context
        this.parent
          .getRootNode()
          .querySelector(".scrim")
          .prepend(fragment);

      default:
        // Note: when triggered via a MutationRecord, it's possible that the
        // target is not the immediate parent. This appends the controller as
        // the first element of the target, which may not be the parent.
        this.parent.insertBefore(fragment, this.parent.firstChild);
    }
    return wrapper;
  };
}

function initializeWhenReady(document) {
  escapeStringRegExp.matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
  function escapeStringRegExp(str) {
    return str.replace(escapeStringRegExp.matchOperatorsRe, "\\$&");
  }

  var blacklisted = false;
  tc.settings.blacklist.split("\n").forEach(match => {
    match = match.replace(regStrip, "");
    if (match.length == 0) {
      return;
    }

    if (match.startsWith("/")) {
      try {
        var regexp = new RegExp(match);
      } catch (err) {
        return;
      }
    } else {
      var regexp = new RegExp(escapeStringRegExp(match));
    }

    if (regexp.test(location.href)) {
      blacklisted = true;
      return;
    }
  });

  if (blacklisted) return;

  window.onload = () => {
    initializeNow(window.document);
  };
  if (document) {
    if (document.readyState === "complete") {
      initializeNow(document);
    } else {
      document.onreadystatechange = () => {
        if (document.readyState === "complete") {
          initializeNow(document);
        }
      };
    }
  }
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}
function getShadow(parent) {
  let result = [];
  function getChild(parent) {
    if (parent.firstElementChild) {
      var child = parent.firstElementChild;
      do {
        result.push(child);
        getChild(child);
        if (child.shadowRoot) {
          result.push(getShadow(child.shadowRoot));
        }
        child = child.nextElementSibling;
      } while (child);
    }
  }
  getChild(parent);
  return result.flat(Infinity);
}
function getController(id) {
  return getShadow(document.body).filter(x => {
    return (
      x.attributes["data-vscid"] &&
      x.tagName == "DIV" &&
      x.attributes["data-vscid"].value == `${id}`
    );
  })[0];
}

function initializeNow(document) {
  if (!tc.settings.enabled) return;
  // enforce init-once due to redundant callers
  if (!document.body || document.body.classList.contains("vsc-initialized")) {
    return;
  }
  document.body.classList.add("vsc-initialized");

  if (document === window.document) {
    defineVideoController();
  } else {
    var link = document.createElement("link");
    link.href = chrome.runtime.getURL("inject.css");
    link.type = "text/css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  var docs = Array(document);
  try {
    if (inIframe()) docs.push(window.top.document);
  } catch (e) {}

  docs.forEach(function(doc) {
    doc.addEventListener(
      "keydown",
      function(event) {
        var keyCode = event.keyCode;

        // Ignore if following modifier is active.
        if (
          !event.getModifierState ||
          event.getModifierState("Alt") ||
          event.getModifierState("Control") ||
          event.getModifierState("Fn") ||
          event.getModifierState("Meta") ||
          event.getModifierState("Hyper") ||
          event.getModifierState("OS")
        ) {
          return;
        }

        // Ignore keydown event if typing in an input box
        if (
          event.target.nodeName === "INPUT" ||
          event.target.nodeName === "TEXTAREA" ||
          event.target.isContentEditable
        ) {
          return false;
        }

        // Ignore keydown event if typing in a page without vsc
        if (
          !getShadow(document.body).filter(x => x.tagName == "vsc-controller")
        ) {
          return false;
        }

        var item = tc.settings.keyBindings.find(item => item.key === keyCode);
        if (item) {
          runAction(item.action, document, item.value);
          if (item.force === "true") {
            // disable websites key bindings
            event.preventDefault();
            event.stopPropagation();
          }
        }

        return false;
      },
      true
    );
  });

  function checkForVideo(node, parent, added) {
    // Only proceed with supposed removal if node is missing from DOM
    if (!added && document.body.contains(node)) {
      return;
    }
    if (
      node.nodeName === "VIDEO" ||
      (node.nodeName === "AUDIO" && tc.settings.audioBoolean)
    ) {
      if (added) {
        node.vsc = new tc.videoController(node, parent);
      } else {
        let id = node.dataset["vscid"];
        if (id) {
          node.vsc.remove();
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
    requestIdleCallback(
      _ => {
        mutations.forEach(function(mutation) {
          switch (mutation.type) {
            case "childList":
              forEach.call(mutation.addedNodes, function(node) {
                if (typeof node === "function") return;
                checkForVideo(node, node.parentNode || mutation.target, true);
              });
              forEach.call(mutation.removedNodes, function(node) {
                if (typeof node === "function") return;
                checkForVideo(node, node.parentNode || mutation.target, false);
              });
              break;
            case "attributes":
              if (
                mutation.target.attributes["aria-hidden"] &&
                mutation.target.attributes["aria-hidden"].value == "false"
              ) {
                var flattenedNodes = getShadow(document.body);
                var node = flattenedNodes.filter(x => x.tagName == "VIDEO")[0];
                if (node) {
                  var oldController = flattenedNodes.filter(x =>
                    x.classList.contains("vsc-controller")
                  )[0];
                  if (oldController) {
                    oldController.remove();
                  }
                  checkForVideo(node, node.parentNode || mutation.target, true);
                }
              }
              break;
          }
        });
      },
      { timeout: 1000 }
    );
  });
  observer.observe(document, {
    attributeFilter: ["aria-hidden"],
    childList: true,
    subtree: true
  });

  if (tc.settings.audioBoolean) {
    var mediaTags = document.querySelectorAll("video,audio");
  } else {
    var mediaTags = document.querySelectorAll("video");
  }

  forEach.call(mediaTags, function(video) {
    video.vsc = new tc.videoController(video);
  });

  var frameTags = document.getElementsByTagName("iframe");
  forEach.call(frameTags, function(frame) {
    // Ignore frames we don't have permission to access (different origin).
    try {
      var childDocument = frame.contentDocument;
    } catch (e) {
      return;
    }
    initializeWhenReady(childDocument);
  });
}

function runAction(action, document, value, e) {
  if (tc.settings.audioBoolean) {
    var mediaTags = getShadow(document.body).filter(x => {
      return x.tagName == "AUDIO" || x.tagName == "VIDEO";
    });
  } else {
    var mediaTags = getShadow(document.body).filter(x => x.tagName == "VIDEO");
  }

  mediaTags.forEach = Array.prototype.forEach;

  // Get the controller that was used if called from a button press event e
  if (e) {
    var targetController = e.target.getRootNode().host;
  }

  mediaTags.forEach(function(v) {
    var id = v.dataset["vscid"];
    var controller = getController(id);
    // Don't change video speed if the video has a different controller
    if (e && !(targetController == controller)) {
      return;
    }

    // Controller may have been (force) removed by the site, guard to prevent crashes but run the command
    if (controller) {
      showController(controller);
    }

    if (!v.classList.contains("vsc-cancelled")) {
      if (action === "rewind") {
        v.currentTime -= value;
      } else if (action === "advance") {
        v.currentTime += value;
      } else if (action === "faster") {
        // Maximum playback speed in Chrome is set to 16:
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=166
        var s = Math.min(
          (v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + value,
          16
        );
        v.playbackRate = Number(s.toFixed(2));
      } else if (action === "slower") {
        // Video min rate is 0.0625:
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=165
        var s = Math.max(v.playbackRate - value, 0.07);
        v.playbackRate = Number(s.toFixed(2));
      } else if (action === "reset") {
        resetSpeed(v, 1.0);
      } else if (action === "display") {
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
      } else if (action === "blink") {
        // if vsc is hidden, show it briefly to give the use visual feedback that the action is excuted.
        if (
          controller.classList.contains("vsc-hidden") ||
          controller.blinkTimeOut !== undefined
        ) {
          clearTimeout(controller.blinkTimeOut);
          controller.classList.remove("vsc-hidden");
          controller.blinkTimeOut = setTimeout(
            () => {
              controller.classList.add("vsc-hidden");
              controller.blinkTimeOut = undefined;
            },
            value ? value : 1000
          );
        }
      } else if (action === "drag") {
        handleDrag(v, controller, e);
      } else if (action === "fast") {
        resetSpeed(v, value);
      } else if (action === "pause") {
        pause(v);
      } else if (action === "muted") {
        muted(v, value);
      } else if (action === "mark") {
        setMark(v);
      } else if (action === "jump") {
        jumpToMark(v);
      }
    }
  });
}

function pause(v) {
  if (v.paused) {
    v.play();
  } else {
    v.pause();
  }
}

function resetSpeed(v, target) {
  if (v.playbackRate === target) {
    if (v.playbackRate === getKeyBindings("reset")) {
      // resetSpeed
      if (target !== 1.0) {
        v.playbackRate = 1.0;
      } else {
        v.playbackRate = getKeyBindings("fast"); // fastSpeed
      }
    } else {
      v.playbackRate = getKeyBindings("reset"); // resetSpeed
    }
  } else {
    setKeyBindings("reset", v.playbackRate); // resetSpeed
    v.playbackRate = target;
  }
}

function muted(v, value) {
  v.muted = v.muted !== true;
}

function setMark(v) {
  v.vsc.mark = v.currentTime;
}

function jumpToMark(v) {
  if (v.vsc.mark && typeof v.vsc.mark === "number") {
    v.currentTime = v.vsc.mark;
  }
}

function handleDrag(video, controller, e) {
  const shadowController = controller.shadowRoot.querySelector("#controller");

  // Find nearest parent of same size as video parent.
  var parentElement = controller.parentElement;
  while (
    parentElement.parentNode &&
    parentElement.parentNode.offsetHeight === parentElement.offsetHeight &&
    parentElement.parentNode.offsetWidth === parentElement.offsetWidth
  ) {
    parentElement = parentElement.parentNode;
  }

  video.classList.add("vcs-dragging");
  shadowController.classList.add("dragging");

  const initialMouseXY = [e.clientX, e.clientY];
  const initialControllerXY = [
    parseInt(shadowController.style.left),
    parseInt(shadowController.style.top)
  ];

  const startDragging = e => {
    let style = shadowController.style;
    let dx = e.clientX - initialMouseXY[0];
    let dy = e.clientY - initialMouseXY[1];
    style.left = initialControllerXY[0] + dx + "px";
    style.top = initialControllerXY[1] + dy + "px";
  };

  const stopDragging = () => {
    parentElement.removeEventListener("mousemove", startDragging);
    parentElement.removeEventListener("mouseup", stopDragging);
    parentElement.removeEventListener("mouseleave", stopDragging);

    shadowController.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };

  parentElement.addEventListener("mouseup", stopDragging);
  parentElement.addEventListener("mouseleave", stopDragging);
  parentElement.addEventListener("mousemove", startDragging);
}

var timer;
var animation = false;
function showController(controller) {
  controller.classList.add("vcs-show");

  if (animation) clearTimeout(timer);

  animation = true;
  timer = setTimeout(function() {
    controller.classList.remove("vcs-show");
    animation = false;
  }, 2000);
}
