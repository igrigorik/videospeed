# Custom Player Handler Guide

Video Speed Controller uses site handlers to adapt to sites with custom video players. If a site uses non-standard DOM structure, a custom player API, or needs special behavior, you write a handler.

## Quick start

Create a file in `src/site-handlers/` that extends `BaseSiteHandler`:

```js
window.VSC = window.VSC || {};

class ExampleHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return location.hostname === 'www.example.com';
  }
}

window.VSC.ExampleHandler = ExampleHandler;
```

Register it in `src/site-handlers/index.js`:

```js
this.availableHandlers = [
  // ...existing handlers...
  window.VSC.ExampleHandler,
];
```

Only override the methods you need. The base class provides sensible defaults for everything.

## Architecture

Site handlers run in the **page context** (MAIN world) via the `inject.js` bundle. They have full access to the page DOM and any player APIs exposed on `window`. They do **not** have access to `chrome.*` extension APIs.

The `SiteHandlerManager` selects the first handler whose `static matches()` returns `true`, creates a singleton instance, and delegates all site-specific calls to it. If no handler matches, `BaseSiteHandler` is used directly.

## API reference

### Lifecycle

#### `static matches()`

Determines if this handler should be used for the current page.

```js
static matches() {
  return location.hostname === 'www.example.com';
}
```

Called once during handler detection. Return `true` to claim this site.

#### `initialize(document)`

Called once when the extension starts up on the page. Use for setting up observers, injecting site-specific CSS, or any one-time setup.

```js
initialize(document) {
  super.initialize(document);
  // your setup here
}
```

Always call `super.initialize(document)` first.

#### `cleanup()`

Called when the extension is torn down (user disables it, navigates away on an SPA, etc.). Clean up any observers, timers, or DOM modifications you created in `initialize()`.

```js
cleanup() {
  super.cleanup();
  if (this.myObserver) {
    this.myObserver.disconnect();
    this.myObserver = null;
  }
}
```

### Video discovery

These methods help the extension find and filter video elements on the page.

#### `shouldIgnoreVideo(video)`

Return `true` to skip a video element. Use this to filter out thumbnails, ads, or preview videos that shouldn't get a speed controller.

```js
shouldIgnoreVideo(video) {
  return video.classList.contains('preview-thumbnail');
}
```

#### `getVideoContainerSelectors()`

Return CSS selectors that help the media scanner find video containers. These are used as hints, not strict requirements.

```js
getVideoContainerSelectors() {
  return ['.custom-player', '#main-video-wrapper'];
}
```

#### `detectSpecialVideos(document)`

Return an array of video elements that can't be found through normal DOM scanning (e.g., inside shadow DOM or cross-origin-accessible iframes).

```js
detectSpecialVideos(document) {
  const player = document.querySelector('custom-player');
  if (player?.shadowRoot) {
    return Array.from(player.shadowRoot.querySelectorAll('video'));
  }
  return [];
}
```

### UI

#### `getControllerPosition(parent, video)`

Controls where the speed controller overlay is inserted in the DOM. Return an object with:

- `insertionPoint` - the element to insert into
- `insertionMethod` - `'firstChild'`, `'beforeParent'`, or `'afterParent'`
- `targetParent` - the element used for positioning context

```js
getControllerPosition(parent, _video) {
  // Insert into the player wrapper, above the video
  return {
    insertionPoint: parent.parentElement,
    insertionMethod: 'firstChild',
    targetParent: parent.parentElement,
  };
}
```

Override this when a site's player has overlays or stacking contexts that would cover the default position.

### Playback

These are the core operations. Each method **owns** the operation entirely -- the base class provides the default implementation, and your override replaces it completely.

#### `handleSpeedChange(video, speed)`

Called whenever the extension sets playback speed. This includes user-initiated speed changes, programmatic changes, and fight-back speed restoration.

**Default behavior:**
```js
handleSpeedChange(video, speed) {
  video.playbackRate = speed;
}
```

Override when a site's player maintains its own speed state that must stay in sync with `video.playbackRate`. For example, if a site has a custom player API:

```js
handleSpeedChange(video, speed) {
  video.playbackRate = speed;
  const player = document.querySelector('#custom-player');
  if (player?.setPlaybackRate) {
    player.setPlaybackRate(speed);
  }
}
```

**Important:** Your override must always set `video.playbackRate`. The extension reads this property to determine the current speed. If you only call the site's API without setting `video.playbackRate`, the extension will think the speed didn't change.

**When is this called?**

| Scenario | Example |
|---|---|
| User changes speed | Keyboard shortcut, popup slider |
| Extension restores speed | Page load with "remember speed" enabled |
| Fight-back | Site tried to reset speed, extension restores it |
| Cooldown restore | Site changed speed during cooldown window |

All paths go through `handleSpeedChange`. There are no direct `video.playbackRate` assignments in the extension's core.

#### `handleSeek(video, seekSeconds)`

Called when the user seeks forward or backward. The `seekSeconds` value is negative for rewind.

**Default behavior:**
```js
handleSeek(video, seekSeconds) {
  const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seekSeconds));
  video.currentTime = newTime;
  return true;
}
```

Override when the site's player has its own seeking API (e.g., Netflix):

```js
handleSeek(video, seekSeconds) {
  window.postMessage({
    action: 'seek',
    seekMs: seekSeconds * 1000,
  }, 'https://www.example.com');
  return true;
}
```

## How speed changes flow through the system

Understanding the speed change pipeline helps when debugging or writing a handler.

```
User action (keyboard, popup, etc.)
  |
  v
ActionHandler.adjustSpeed(video, value, options)
  |  - calculates target speed (absolute or relative)
  |  - clamps to [0.07, 16]
  |  - rounds to 2 decimal places
  v
ActionHandler.setSpeed(video, speed, source)
  |  1. Starts cooldown (prevents ratechange re-entry)
  |  2. Calls siteHandlerManager.handleSpeedChange(video, speed)
  |     --> your handler runs here
  |  3. Dispatches synthetic ratechange event
  |  4. Updates UI indicator
  |  5. Persists to storage (if rememberSpeed enabled)
  v
Done
```

When a site externally changes `video.playbackRate` (e.g., the site's own speed controls), the fight-back system detects it and calls `handleSpeedChange` to restore the user's speed. This means your handler's sync logic runs during fight-back too, keeping the site's player in sync.

## Existing handlers

| Handler | Site | Key overrides |
|---|---|---|
| `YouTubeHandler` | youtube.com | Controller positioning, autohide CSS forwarding, video filtering |
| `NetflixHandler` | netflix.com | Controller positioning, custom seeking via postMessage |
| `FacebookHandler` | facebook.com | Controller positioning, dynamic content observer |
| `AmazonHandler` | amazon.com, primevideo.com | Controller positioning, size-based video filtering |
| `AppleHandler` | tv.apple.com | Controller positioning, shadow DOM video detection |

## Testing

Tests go in `tests/unit/site-handlers/`. The test infrastructure provides:

- `createMockVideo(options)` - creates a video element with configurable properties
- `createMockDOM()` - sets up a minimal DOM environment
- `installChromeMock()` / `cleanupChromeMock()` - mocks the Chrome extension API
- `window.VSC.siteHandlerManager` - available after `installChromeMock()` + module loading

To verify your handler is called during speed changes:

```js
const manager = window.VSC.siteHandlerManager;
const handler = manager.getCurrentHandler();
const spy = vi.spyOn(handler, 'handleSpeedChange');

actionHandler.adjustSpeed(mockVideo, 2.0);

expect(spy).toHaveBeenCalledWith(mockVideo, 2.0);
```

Run tests with:

```
npm test
```
