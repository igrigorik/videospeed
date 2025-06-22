/**
 * Drag functionality for video controller
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class DragHandler {
  /**
   * Handle dragging of video controller
   * @param {HTMLVideoElement} video - Video element
   * @param {MouseEvent} e - Mouse event
   */
  static handleDrag(video, e) {
    const controller = video.vsc.div;
    const shadowController = controller.shadowRoot.querySelector('#controller');

    // Find nearest parent of same size as video parent
    const parentElement = window.VSC.DomUtils.findVideoParent(controller);

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const initialMouseXY = [e.clientX, e.clientY];
    const initialControllerXY = [
      parseInt(shadowController.style.left) || 0,
      parseInt(shadowController.style.top) || 0,
    ];

    const startDragging = (e) => {
      const style = shadowController.style;
      const dx = e.clientX - initialMouseXY[0];
      const dy = e.clientY - initialMouseXY[1];

      style.left = `${initialControllerXY[0] + dx}px`;
      style.top = `${initialControllerXY[1] + dy}px`;
    };

    const stopDragging = () => {
      parentElement.removeEventListener('mousemove', startDragging);
      parentElement.removeEventListener('mouseup', stopDragging);
      parentElement.removeEventListener('mouseleave', stopDragging);

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');

      window.VSC.logger.debug('Drag operation completed');
    };

    parentElement.addEventListener('mouseup', stopDragging);
    parentElement.addEventListener('mouseleave', stopDragging);
    parentElement.addEventListener('mousemove', startDragging);

    window.VSC.logger.debug('Drag operation started');
  }
}

// Create singleton instance
window.VSC.DragHandler = DragHandler;
