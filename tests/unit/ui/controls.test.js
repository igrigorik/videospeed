describe('ControlsManager', () => {
  function setupWheelHandler() {
    const actionHandler = { adjustSpeed: vi.fn() };
    const controls = new window.VSC.ControlsManager(actionHandler, {});
    const shadow = document.createElement('div');
    const controller = document.createElement('div');
    const video = document.createElement('video');

    controller.id = 'controller';
    shadow.appendChild(controller);
    controls.setupWheelHandler(shadow, video);

    const mouseenter = new MouseEvent('mouseenter');
    Object.defineProperty(mouseenter, 'timeStamp', { value: 100 });
    controller.dispatchEvent(mouseenter);

    return { actionHandler, controller, video };
  }

  function dispatchWheel(controller, options) {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: -100,
      ...options,
    });
    Object.defineProperty(event, 'timeStamp', { value: 500 });
    controller.dispatchEvent(event);
    return event;
  }

  it('ignores browser zoom gestures without preventing their default behavior', () => {
    const { actionHandler, controller } = setupWheelHandler();

    const event = dispatchWheel(controller, { ctrlKey: true });

    expect(actionHandler.adjustSpeed).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('still adjusts speed for an unmodified mouse wheel after hover dwell', () => {
    const { actionHandler, controller, video } = setupWheelHandler();

    const event = dispatchWheel(controller);

    expect(actionHandler.adjustSpeed).toHaveBeenCalledWith(video, 0.1, { relative: true });
    expect(event.defaultPrevented).toBe(true);
  });
});
