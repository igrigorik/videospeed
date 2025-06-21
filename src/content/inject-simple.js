/**
 * Simple functional Video Speed Controller without ES6 modules
 */

console.log('🚀 Video Speed Controller loaded!');

class VideoSpeedController {
  constructor() {
    console.log('✅ VideoSpeedController created');
    this.currentSpeed = 1.0;
    this.videos = [];
    this.initialized = false;
    this.keyboardSetup = false;
    this.init();
  }
  
  init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupController());
    } else {
      this.setupController();
    }
    
    // Also setup when videos are added dynamically
    setTimeout(() => this.setupController(), 2000);
    setTimeout(() => this.setupController(), 5000);
  }
  
  setupController() {
    // Prevent multiple initializations
    if (this.initialized) {
      console.log('🔄 Controller already initialized, checking for new videos...');
      this.findVideos();
      this.createSpeedController();
      return;
    }
    
    this.findVideos();
    this.createSpeedController();
    this.setupKeyboardShortcuts();
    this.injectSiteScript();
    this.initialized = true;
    console.log('✅ Controller setup complete');
  }
  
  findVideos() {
    const videos = document.querySelectorAll('video');
    console.log(`🎬 Found ${videos.length} video elements`);
    
    videos.forEach(video => {
      if (!this.videos.includes(video)) {
        this.videos.push(video);
        console.log(`📹 Added video: ${video.src || video.currentSrc || 'no src'}`);
      } else {
        console.log(`🔄 Video already tracked: ${video.src || video.currentSrc || 'no src'}`);
      }
    });
    
    // Clean up videos that are no longer in the DOM
    this.videos = this.videos.filter(video => {
      if (document.contains(video)) {
        return true;
      } else {
        console.log('🗑️ Removing video no longer in DOM');
        if (video.vsc && video.vsc.div) {
          try {
            video.vsc.div.remove();
          } catch (e) {
            // Already removed
          }
        }
        return false;
      }
    });
  }
  
  createSpeedController() {
    // Only create controllers for videos that don't have them
    this.videos.forEach(video => {
      if (!video.vsc || !video.vsc.div || !document.contains(video.vsc.div)) {
        console.log('🎛️ Creating controller for video without one');
        this.createControllerForVideo(video);
      } else {
        console.log('🔄 Video already has controller, skipping');
      }
    });
    
    console.log('✅ Speed controller UI verified for all videos');
  }

  createControllerForVideo(video) {
    if (video.vsc && video.vsc.div && document.contains(video.vsc.div)) {
      return video.vsc.div; // Already has controller and it's in DOM
    }
    
    // Clean up any stale controller references
    if (video.vsc && video.vsc.div) {
      try {
        video.vsc.div.remove();
      } catch (e) {
        // Controller might already be removed
      }
    }

    const document = video.ownerDocument;
    const speed = this.currentSpeed.toFixed(2);
    
    // Calculate position relative to video (original logic)
    const rect = video.getBoundingClientRect();
    const offsetRect = video.offsetParent?.getBoundingClientRect();
    const top = Math.max(rect.top - (offsetRect?.top || 0), 0) + "px";
    const left = Math.max(rect.left - (offsetRect?.left || 0), 0) + "px";

    // Create controller wrapper with unique ID for each video
    const wrapper = document.createElement("div");
    wrapper.classList.add("vsc-controller");
    const controllerId = `vsc-speed-controller-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    wrapper.id = controllerId;

    // Create shadow DOM (original approach)
    const shadow = wrapper.attachShadow({ mode: "open" });
    const shadowTemplate = `
      <style>
        @import "${chrome.runtime.getURL("shadow.css")}";
      </style>
      <div id="controller" style="top:${top}; left:${left}; opacity:0.3;">
        <span data-action="drag" class="draggable" style="font-size: 14px; line-height: 14px;">${speed}</span>
        <span id="controls" style="font-size: 14px; line-height: 14px;">
          <button data-action="rewind" class="rw">«</button>
          <button data-action="slower">&minus;</button>
          <button data-action="faster">&plus;</button>
          <button data-action="advance" class="rw">»</button>
          <button data-action="display" class="hideButton">&times;</button>
        </span>
      </div>
    `;
    
    shadow.innerHTML = shadowTemplate;

    // Add event listeners (from original)
    shadow.querySelector(".draggable").addEventListener("mousedown", (e) => {
      this.handleAction(e.target.dataset["action"], e);
      e.stopPropagation();
      e.preventDefault();
    }, true);

    shadow.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.handleAction(e.target.dataset["action"]);
        e.stopPropagation();
      }, true);
      button.addEventListener("touchstart", (e) => {
        e.stopPropagation();
      }, true);
    });

    shadow.querySelector("#controller").addEventListener("click", (e) => e.stopPropagation(), false);
    shadow.querySelector("#controller").addEventListener("mousedown", (e) => e.stopPropagation(), false);

    // Store reference to speed indicator
    const speedIndicator = shadow.querySelector(".draggable");
    
    // Insert controller using original logic for different sites
    const fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    const parent = video.parentElement;
    switch (true) {
      case location.hostname == "www.amazon.com" && !video.classList.contains("vjs-tech"):
      case location.hostname == "www.reddit.com":
        parent.parentElement.insertBefore(fragment, parent);
        break;
      case location.hostname == "www.facebook.com":
        let p = parent.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement;
        p.insertBefore(fragment, p.firstChild);
        break;
      case location.hostname == "www.youtube.com":
        let youtubeParent = parent.parentElement;
        youtubeParent.insertBefore(fragment, youtubeParent.firstChild);
        break;
      case location.hostname == "tv.apple.com":
        parent.parentNode.insertBefore(fragment, parent.parentNode.firstChild);
        break;
      default:
        parent.insertBefore(fragment, parent.firstChild);
    }

    // Store controller reference on video (original pattern)
    if (!video.vsc) {
      video.vsc = {};
    }
    video.vsc.div = wrapper;
    video.vsc.speedIndicator = speedIndicator;
    
    return wrapper;
  }
  
  setupKeyboardShortcuts() {
    // Prevent duplicate keyboard event listeners
    if (this.keyboardSetup) {
      console.log('⌨️ Keyboard shortcuts already setup');
      return;
    }
    
    document.addEventListener('keydown', (e) => {
      // Don't interfere with typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      switch(e.key.toLowerCase()) {
        case 's':
          this.handleAction('slower');
          e.preventDefault();
          break;
        case 'd':
          this.handleAction('faster');
          e.preventDefault();
          break;
        case 'r':
          this.handleAction('reset');
          e.preventDefault();
          break;
        case 'z':
          this.handleAction('rewind');
          e.preventDefault();
          break;
        case 'x':
          this.handleAction('advance');
          e.preventDefault();
          break;
        case 'v':
          this.handleAction('display');
          e.preventDefault();
          break;
        case 'g':
          this.handleAction('fast');
          e.preventDefault();
          break;
      }
    });
    
    this.keyboardSetup = true;
    console.log('✅ Keyboard shortcuts setup');
  }
  
  handleAction(action, event = null) {
    console.log(`🎯 Action: ${action}`);
    
    switch(action) {
      case 'faster':
        this.changeSpeed(0.1);
        break;
      case 'slower':
        this.changeSpeed(-0.1);
        break;
      case 'reset':
        this.resetSpeed(1.0);
        break;
      case 'rewind':
        this.seekVideo(-10);
        break;
      case 'advance':
        this.seekVideo(10);
        break;
      case 'display':
        this.toggleDisplay();
        break;
      case 'fast':
        this.resetSpeed(1.8); // Default fast speed with toggle logic
        break;
      case 'drag':
        if (event) {
          this.handleDrag(event);
        }
        break;
    }
  }
  
  toggleDisplay() {
    console.log('🔄 Toggling controller display');
    this.videos.forEach(video => {
      if (video.vsc && video.vsc.div) {
        const controller = video.vsc.div;
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
      }
    });
  }
  
  handleDrag(event) {
    console.log('🖱️ Handling drag action');
    // Basic drag implementation - can be enhanced later
    // For now, just prevent default behavior
    event.preventDefault();
  }
  
  changeSpeed(delta) {
    const newSpeed = Math.max(0.25, Math.min(4.0, this.currentSpeed + delta));
    this.setSpeed(newSpeed);
  }
  
  setSpeed(speed) {
    this.currentSpeed = speed;
    console.log(`⚡ Setting speed to: ${speed}x`);
    
    this.videos.forEach(video => {
      video.playbackRate = speed;
      
      // Update the speed indicator for this video's controller
      if (video.vsc && video.vsc.speedIndicator) {
        video.vsc.speedIndicator.textContent = speed.toFixed(2);
      }
    });
    
    console.log(`✅ Speed changed to ${speed}x for ${this.videos.length} videos`);
  }
  
  resetSpeed(target) {
    // Replicate original resetSpeed logic with toggle behavior
    console.log(`🔄 Reset speed called with target: ${target}`);
    
    const currentSpeed = this.currentSpeed;
    const resetSpeed = 1.0; // Default reset speed
    const fastSpeed = 1.8; // Default fast speed
    
    if (Math.abs(currentSpeed - target) < 0.01) { // Current speed equals target
      if (Math.abs(currentSpeed - resetSpeed) < 0.01) { // Currently at reset speed
        if (target !== 1.0) {
          console.log('🔄 Resetting playback speed to 1.0');
          this.setSpeed(1.0);
        } else {
          console.log('🔄 Toggling playback speed to "fast" speed');
          this.setSpeed(fastSpeed);
        }
      } else {
        console.log('🔄 Toggling playback speed to "reset" speed');
        this.setSpeed(resetSpeed);
      }
    } else {
      console.log('🔄 Setting speed to target');
      this.setSpeed(target);
    }
  }
  
  seekVideo(seconds) {
    console.log(`⏩ Seeking ${seconds} seconds`);
    
    this.videos.forEach(video => {
      if (video.currentTime !== undefined && video.duration) {
        const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
        video.currentTime = newTime;
      }
    });
  }
  
  injectSiteScript() {
    // Inject site-specific scripts (from original logic)
    const elt = document.createElement("script");
    switch (true) {
      case location.hostname == "www.netflix.com":
        elt.src = chrome.runtime.getURL('scriptforsite/netflix.js');
        break;
    }
    if (elt.src) {
      document.head.appendChild(elt);
      console.log(`🌐 Site-specific script injected: ${elt.src}`);
    }
  }
}

// Initialize extension
window.VideoSpeedExtension = VideoSpeedController;
window.videoSpeedExtension = new VideoSpeedController();

// Message handler for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Sender verification - only accept messages from our extension
  if (!sender.id || sender.id !== chrome.runtime.id) {
    return;
  }

  // Handle VSC namespaced message types
  if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
    const controller = window.videoSpeedExtension;
    
    switch (message.type) {
      case 'VSC_SET_SPEED':
        if (message.payload && typeof message.payload.speed === 'number') {
          const targetSpeed = message.payload.speed;
          console.log(`📨 Popup message: Set speed to ${targetSpeed}`);
          controller.setSpeed(targetSpeed);
        }
        break;

      case 'VSC_ADJUST_SPEED':
        if (message.payload && typeof message.payload.delta === 'number') {
          const delta = message.payload.delta;
          console.log(`📨 Popup message: Adjust speed by ${delta}`);
          controller.changeSpeed(delta);
        }
        break;

      case 'VSC_RESET_SPEED':
        console.log('📨 Popup message: Reset speed');
        controller.setSpeed(1.0);
        break;

      case 'VSC_TOGGLE_DISPLAY':
        console.log('📨 Popup message: Toggle display');
        controller.toggleDisplay();
        break;
    }
  }
});

console.log('✅ Video Speed Controller ready!');