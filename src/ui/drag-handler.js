/**
 * Drag functionality for video controller
 * Uses pointer events for unified mouse + touch support
 */

window.VSC = window.VSC || {};

class DragHandler {
  /**
   * Handle dragging of video controller via pointer events
   * @param {HTMLVideoElement} video - Video element
   * @param {PointerEvent|MouseEvent} e - Pointer/mouse event
   */
  static handleDrag(video, e) {
    const controller = video.vsc.div;
    const shadowController = controller.shadowRoot.querySelector('#controller');

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const initialXY = [e.clientX, e.clientY];
    const initialControllerXY = [
      parseInt(shadowController.style.left) || 0,
      parseInt(shadowController.style.top) || 0,
    ];

    const draggable = e.target;

    // Capture pointer so all move/up events route here regardless of position
    if (e.pointerId !== undefined) {
      draggable.setPointerCapture(e.pointerId);
    }

    const onMove = (ev) => {
      const dx = ev.clientX - initialXY[0];
      const dy = ev.clientY - initialXY[1];
      shadowController.style.left = `${initialControllerXY[0] + dx}px`;
      shadowController.style.top = `${initialControllerXY[1] + dy}px`;
    };

    const onEnd = () => {
      draggable.removeEventListener('pointermove', onMove);
      draggable.removeEventListener('pointerup', onEnd);
      draggable.removeEventListener('pointercancel', onEnd);
      // Mouse fallbacks
      draggable.removeEventListener('mousemove', onMove);
      draggable.removeEventListener('mouseup', onEnd);

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');

      window.VSC.logger.debug('Drag operation completed');
    };

    if (e.pointerId !== undefined) {
      draggable.addEventListener('pointermove', onMove);
      draggable.addEventListener('pointerup', onEnd);
      draggable.addEventListener('pointercancel', onEnd);
    } else {
      // Fallback for environments without pointer events
      draggable.addEventListener('mousemove', onMove);
      draggable.addEventListener('mouseup', onEnd);
    }

    window.VSC.logger.debug('Drag operation started');
  }
}

// Create singleton instance
window.VSC.DragHandler = DragHandler;
