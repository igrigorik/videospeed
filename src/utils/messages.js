/**
 * Messages on the VSC_MESSAGE channel, from the content bridge to the page
 * script. Pure ES module, shared by the popup, the bridge, and the page.
 */

export const MESSAGE_TYPES = Object.freeze({
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
  TEARDOWN: 'VSC_TEARDOWN',
});

/**
 * The commands an extension page may send to a tab, each with the one payload
 * number it carries, if any. TEARDOWN is absent: only the bridge issues it.
 */
const COMMAND_PAYLOADS = Object.freeze({
  [MESSAGE_TYPES.SET_SPEED]: 'speed',
  [MESSAGE_TYPES.ADJUST_SPEED]: 'delta',
  [MESSAGE_TYPES.RESET_SPEED]: null,
  [MESSAGE_TYPES.TOGGLE_DISPLAY]: null,
});

/**
 * Rebuild a command from its known fields. The bridge dispatches the result
 * where the page can read it, so a runtime message is never forwarded as is:
 * extra fields are dropped, and anything that is not a well-formed command
 * yields null.
 *
 * @param {*} request - A chrome.runtime message
 * @returns {{type: string, payload?: Object}|null}
 */
export function readCommand(request) {
  const type = request?.type;
  if (typeof type !== 'string' || !Object.hasOwn(COMMAND_PAYLOADS, type)) {
    return null;
  }

  const field = COMMAND_PAYLOADS[type];
  if (!field) {
    return { type };
  }

  const value = request.payload?.[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? { type, payload: { [field]: value } }
    : null;
}
