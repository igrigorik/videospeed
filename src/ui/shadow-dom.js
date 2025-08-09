/**
 * Shadow DOM creation and management
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class ShadowDOMManager {
  /**
   * Detect the visible height of the page/player controls that sit at the bottom of the video.
   * Falls back to heuristics when exact height can't be measured.
   * @param {HTMLVideoElement} video
   * @returns {number} height in pixels
   */
  static detectNativeControlsHeight(video, targetElement) {
    try {
      // Site-specific: YouTube custom controls
      if (location.hostname === 'www.youtube.com') {
        const ytpControls = document.querySelector('.ytp-chrome-bottom');
        if (ytpControls && ytpControls.offsetHeight) {
          let h = ytpControls.offsetHeight;
          // Include progress bar height if present for better separation
          const progress = document.querySelector('.ytp-progress-bar-container');
          if (progress && progress.offsetHeight) {
            h = Math.max(h, ytpControls.getBoundingClientRect().bottom - progress.getBoundingClientRect().top);
          }
          // When autohide is active, controls are hidden; keep a small baseline (progress bar)
          const player = document.querySelector('.html5-video-player');
          if (player && player.classList.contains('ytp-autohide')) {
            const progressH = progress?.offsetHeight || 4;
            return Math.max(progressH + 6, 10);
          }
          return h;
        }
      }

      // Standard native controls
  if (video && video.controls) {
        // Try to read pseudo-element height (Chrome/WebKit only)
        const pseudoCandidates = [
          '::-webkit-media-controls-enclosure',
          '::-webkit-media-controls-panel',
          '::-webkit-media-controls'
        ];

        for (const pseudo of pseudoCandidates) {
          const style = window.getComputedStyle(video, pseudo);
          if (style) {
            const h = parseFloat(style.height);
            if (!Number.isNaN(h) && h > 0) {
              return h;
            }
          }
        }

        // Some platforms report min-height more reliably
        for (const pseudo of pseudoCandidates) {
          const style = window.getComputedStyle(video, pseudo);
          if (style) {
            const h2 = parseFloat(style.minHeight || style.getPropertyValue('min-height'));
            if (!Number.isNaN(h2) && h2 > 0) {
              return h2;
            }
          }
        }

        // Heuristic default for native controls when visible
        return 36; // typical desktop native controls bar height
      }
    } catch (_) {
      // ignore and use fallback
    }

    // Generic overlay detection for custom players (e.g., Substack)
    const overlay = this.detectBottomOverlayHeight(video, targetElement || video);
    if (overlay > 0) {
      return overlay;
    }

    // Default minimal offset when no native controls are visible
    return 0;
  }

  /**
   * Detect any overlaying controls near the bottom of the player by sampling elementsFromPoint.
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} targetElement - container used for positioning
   * @returns {number} overlay height in pixels
   */
  static detectBottomOverlayHeight(video, targetElement) {
    try {
      const rect = targetElement.getBoundingClientRect();
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const x = Math.min(Math.max(rect.left + rect.width / 2, 0), vw - 1);

      // Skip if API missing
      if (typeof document.elementsFromPoint !== 'function') {
        return 0;
      }

      const scanDepth = Math.min(120, Math.floor(rect.height / 3));
      for (let dy = 1; dy <= scanDepth; dy += 2) {
        const y = rect.bottom - dy;
        if (y < rect.top) break;
        const stack = document.elementsFromPoint(x, y) || [];
        const found = stack.find((el) => {
          if (!el || el === video) return false;
          if (el.closest && el.closest('.vsc-controller')) return false;
          // Must overlap horizontally with the video area
          const br = el.getBoundingClientRect();
          const horizontallyOverlaps = !(br.right < rect.left || br.left > rect.right);
          const verticallyOverlaps = br.top < rect.bottom && br.bottom > rect.top;
          // Exclude body/html/document roots
          const isRoot = el === document.body || el === document.documentElement;
          return horizontallyOverlaps && verticallyOverlaps && !isRoot;
        });

        if (found) {
          const fr = found.getBoundingClientRect();
          const overlapTop = Math.max(fr.top, rect.top);
          let height = Math.max(0, rect.bottom - overlapTop);
          // Cap overlay height to reasonable values (avoid taking half the player)
          const capPx = 160;
          const capPct = rect.height * 0.4;
          height = Math.min(height, capPx, capPct);

          // Ignore tiny overlays (like thin progress lines) under threshold
          if (height >= 6) {
            return height; // first significant overlay near the bottom
          }
        }
      }
      // No overlay found
      return 0;
    } catch (_) {
      return 0;
    }
  }
  /**
   * Create shadow DOM for video controller
   * @param {HTMLElement} wrapper - Wrapper element
   * @param {Object} options - Configuration options
   * @returns {ShadowRoot} Created shadow root
   */
  static createShadowDOM(wrapper, options = {}) {
    const { top = '0px', left = '0px', speed = '1.00', opacity = 0.3, buttonSize = 14, position = 'top-left' } = options;

    const shadow = wrapper.attachShadow({ mode: 'open' });

    // Create style element with embedded CSS
    const style = document.createElement('style');
    
    // Get position configuration
    const positionConfig = window.VSC.Constants.CONTROLLER_POSITIONS[position] || 
                          window.VSC.Constants.CONTROLLER_POSITIONS['top-left'];
    
    // Base CSS with position-specific adjustments
  const baseCSS = `
      * {
        line-height: 1.8em;
        font-family: sans-serif;
        font-size: 13px;
      }
      
      :host(:hover) #controls {
        display: inline-block;
      }
      
      #controller {
        position: absolute;
        top: 0;
        left: 0;
        background: black;
        color: white;
        border-radius: 6px;
        padding: 4px;
        cursor: default;
        z-index: 9999999;
        white-space: nowrap;
        ${positionConfig.left 
          ? 'margin: 10px 10px 10px 15px;' 
          : 'transform: translateX(-100%); margin: 10px 0 10px 10px;'
        }
      }
      
      #controller:hover {
        opacity: 0.7;
      }
      
      #controller:hover>.draggable {
        ${positionConfig.left ? 'margin-right: 0.8em;' : 'margin-left: 0.8em;'}
      }
      
      #controls {
        display: none;
        white-space: nowrap;
      }
      
      #controller.dragging {
        cursor: -webkit-grabbing;
        opacity: 0.7;
      }
      
      #controller.dragging #controls {
        display: inline-block;
      }
      
      .draggable {
        cursor: -webkit-grab;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.8em;
        height: 1.4em;
        text-align: center;
        vertical-align: middle;
        box-sizing: border-box;
        ${!positionConfig?.left ? 'text-align: right;' : ''}
      }
      
      .draggable:active {
        cursor: -webkit-grabbing;
      }
      
      button {
        opacity: 1;
        cursor: pointer;
        color: black;
        background: white;
        font-weight: normal;
        border-radius: 5px;
        padding: 1px 5px 3px 5px;
        font-size: inherit;
        line-height: inherit;
        border: 0px solid white;
        font-family: "Lucida Console", Monaco, monospace;
        margin: 0px 2px 2px 2px;
        transition: background 0.2s, color 0.2s;
      }
      
      button:focus {
        outline: 0;
      }
      
      button:hover {
        opacity: 1;
        background: #2196f3;
        color: #ffffff;
      }
      
      button:active {
        background: #2196f3;
        color: #ffffff;
        font-weight: bold;
      }
      
      button.rw {
        opacity: 0.65;
      }
      
      button.hideButton {
        opacity: 0.65;
        ${positionConfig.left ? 'margin-left: 8px; margin-right: 2px;' : 'margin-right: 8px; margin-left: 2px;'}
      }
    `;
    
    style.textContent = baseCSS;
    shadow.appendChild(style);

    // Create controller div
    const controller = document.createElement('div');
    controller.id = 'controller';
    controller.style.cssText = `top:${top}; left:${left}; opacity:${opacity};`;

    // Create controls span
    const controls = document.createElement('span');
    controls.id = 'controls';
    controls.style.cssText = `font-size: ${buttonSize}px; line-height: ${buttonSize}px;`;

    // Create buttons
    const buttons = [
      { action: 'rewind', text: '«', class: 'rw' },
      { action: 'slower', text: '−', class: '' },
      { action: 'faster', text: '+', class: '' },
      { action: 'advance', text: '»', class: 'rw' },
      { action: 'display', text: '×', class: 'hideButton' },
    ];

    // Create draggable speed indicator
    const draggable = document.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.className = 'draggable';
    draggable.style.cssText = `font-size: ${buttonSize}px;`;
    draggable.textContent = speed;

    if (positionConfig.left) {
      controller.appendChild(draggable);
      
      buttons.forEach((btnConfig) => {
        const button = document.createElement('button');
        button.setAttribute('data-action', btnConfig.action);
        if (btnConfig.class) {
          button.className = btnConfig.class;
        }
        button.textContent = btnConfig.text;
        controls.appendChild(button);
      });
      
      controller.appendChild(controls);
    } else {
      const displayButton = buttons.find(btn => btn.action === 'display');
      if (displayButton) {
        const button = document.createElement('button');
        button.setAttribute('data-action', displayButton.action);
        if (displayButton.class) {
          button.className = displayButton.class;
        }
        button.textContent = displayButton.text;
        controls.appendChild(button);
      }
      
      const innerButtons = buttons.filter(btn => btn.action !== 'display');
      innerButtons.forEach((btnConfig) => {
        const button = document.createElement('button');
        button.setAttribute('data-action', btnConfig.action);
        if (btnConfig.class) {
          button.className = btnConfig.class;
        }
        button.textContent = btnConfig.text;
        controls.appendChild(button);
      });
      
      controller.appendChild(controls);
      controller.appendChild(draggable);
    }
    shadow.appendChild(controller);

    window.VSC.logger.debug('Shadow DOM created for video controller');
    return shadow;
  }

  /**
   * Get controller element from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Controller element
   */
  static getController(shadow) {
    return shadow.querySelector('#controller');
  }

  /**
   * Get controls container from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Controls element
   */
  static getControls(shadow) {
    return shadow.querySelector('#controls');
  }

  /**
   * Get draggable speed indicator from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Speed indicator element
   */
  static getSpeedIndicator(shadow) {
    return shadow.querySelector('.draggable');
  }

  /**
   * Get all buttons from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {NodeList} Button elements
   */
  static getButtons(shadow) {
    return shadow.querySelectorAll('button');
  }

  /**
   * Update speed display in shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @param {number} speed - New speed value
   */
  static updateSpeedDisplay(shadow, speed) {
    const speedIndicator = this.getSpeedIndicator(shadow);
    if (speedIndicator) {
      speedIndicator.textContent = window.VSC.Constants.formatSpeed(speed);
    }
  }

  /**
   * Calculate position for controller based on video element and user preference
   * @param {HTMLVideoElement} video - Video element
   * @param {string} position - Position preference ('top-left', 'top-right', etc.)
   * @returns {Object} Position object with top and left properties
   */
  static calculatePosition(video, position = 'top-left', baseRectOverride = null) {
    let targetElement = video;
    if (location.hostname === 'www.youtube.com') {
      const playerContainer = video.closest('.ytp-player-content.ytp-iv-player-content') || 
                             video.closest('.ytp-player-content') ||
                             video.closest('#movie_player') ||
                             video.closest('.html5-video-player');
      if (playerContainer) {
        targetElement = playerContainer;
      }
    }

  const rect = targetElement.getBoundingClientRect();

  // Allow caller to specify the coordinate base (e.g., controller's offsetParent)
  const offsetRect = baseRectOverride || video.offsetParent?.getBoundingClientRect();
    
    const positionConfig = window.VSC.Constants.CONTROLLER_POSITIONS[position] || 
                          window.VSC.Constants.CONTROLLER_POSITIONS['top-left'];
    
    let top, left;
    
    if (positionConfig.top) {
  top = `${Math.max(rect.top - (offsetRect?.top || 0), 0)}px`;
    } else {
      // Determine dynamic offset so our controller stacks above the native/player controls
      const overlayHeight = this.detectBottomOverlayHeight(video, targetElement);
      const nativeHeuristic = this.detectNativeControlsHeight(video, targetElement); // px
      let nativeControlsHeight = Math.max(overlayHeight, nativeHeuristic);

      // Measure our controller box if present to place exactly; otherwise use heuristics
      let controllerHeight = 0;
      let controllerMarginTop = 10; // default from CSS
      try {
        const wrapper = video?.vsc?.div;
        const controller = wrapper?.shadowRoot?.querySelector('#controller');
        if (controller) {
          const box = controller.getBoundingClientRect();
          controllerHeight = Math.ceil(box.height);
          const cs = window.getComputedStyle(controller);
          const mt = parseFloat(cs.marginTop || '10');
          if (!Number.isNaN(mt)) controllerMarginTop = mt;
        } else {
          // Approximate when not yet rendered
          const defaultBtn = window.VSC.Constants?.DEFAULT_SETTINGS?.controllerButtonSize || 14;
          controllerHeight = Math.round(defaultBtn * 1.4 + 8); // 1.4em + padding
        }
      } catch (_) {
        // Ignore and keep heuristics
        const defaultBtn = window.VSC.Constants?.DEFAULT_SETTINGS?.controllerButtonSize || 14;
        controllerHeight = Math.round(defaultBtn * 1.4 + 8);
      }

  // Ensure clearer separation on YouTube
      const extraSitePad = location.hostname === 'www.youtube.com' ? 10 : 8;
      const padding = extraSitePad; // little padding between native controls and our controller
      let bottomOffset = Math.max(0, nativeControlsHeight + padding + controllerMarginTop + controllerHeight);

      // Keep the controller within the video box; if offset is too large, cap it
      const maxUsableOffset = Math.max(0, rect.height - Math.min(controllerHeight + 10, rect.height * 0.25));
      if (bottomOffset > maxUsableOffset) {
        bottomOffset = maxUsableOffset;
      }

      const calculatedBottom = rect.bottom - (offsetRect?.top || 0) - bottomOffset;
      top = `${Math.max(calculatedBottom, 0)}px`;
    }
    
    if (positionConfig.left) {
      left = `${Math.max(rect.left - (offsetRect?.left || 0), 0)}px`;
    } else {
      const rightEdge = rect.right - (offsetRect?.left || 0);
      // Position wrapper 15px inside; the controller uses translateX(-100%) and margin-right:15
      left = `${Math.max(rightEdge - 15, 0)}px`;
    }

    return { top, left };
  }
}

// Create singleton instance
window.VSC.ShadowDOMManager = ShadowDOMManager;
