/**
 * Control button interactions and event handling
 */

window.VSC = window.VSC || {};

class ControlsManager {
  constructor(actionHandler, config) {
    this.actionHandler = actionHandler;
    this.config = config;
  }

  /**
   * Set up control button event listeners
   * @param {ShadowRoot} shadow - Shadow root containing controls
   * @param {HTMLVideoElement} video - Associated video element
   */
  setupControlEvents(shadow, video) {
    this.setupDragHandler(shadow);
    this.setupButtonHandlers(shadow);
    this.setupWheelHandler(shadow, video);
    this.setupClickPrevention(shadow);
  }

  /**
   * Set up drag handler for speed indicator
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupDragHandler(shadow) {
    const draggable = shadow.querySelector('.draggable');

    draggable.addEventListener(
      'mousedown',
      (e) => {
        this.actionHandler.runAction(e.target.dataset['action'], false, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  }

  /**
   * Set up button click handlers
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupButtonHandlers(shadow) {
    shadow.querySelectorAll('button').forEach((button) => {
      // Click handler
      button.addEventListener(
        'click',
        (e) => {
          this.actionHandler.runAction(
            e.target.dataset['action'],
            this.config.getKeyBinding(e.target.dataset['action']),
            e
          );
          e.stopPropagation();
        },
        true
      );

      // Touch handler to prevent conflicts
      button.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        true
      );
    });
  }

  /**
   * Set up mouse wheel handler for speed control
   * @param {ShadowRoot} shadow - Shadow root
   * @param {HTMLVideoElement} video - Video element
   * @private
   */
  setupWheelHandler(shadow, video) {
    const controller = shadow.querySelector('#controller');

    controller.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();

        const delta = Math.sign(event.deltaY);
        const step = 0.1;
        const speedDelta = delta < 0 ? step : -step;

        this.actionHandler.adjustSpeed(video, speedDelta, { relative: true });

        window.VSC.logger.debug(`Wheel control: adjusting speed by ${speedDelta}`);
      },
      { passive: false }
    );
  }

  /**
   * Set up click prevention for controller container
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupClickPrevention(shadow) {
    const controller = shadow.querySelector('#controller');

    // Prevent clicks from bubbling up to page
    controller.addEventListener('click', (e) => e.stopPropagation(), false);
    controller.addEventListener('mousedown', (e) => e.stopPropagation(), false);
  }
}

// Create singleton instance
window.VSC.ControlsManager = ControlsManager;
