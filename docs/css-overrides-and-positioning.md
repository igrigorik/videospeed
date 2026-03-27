# CSS Overrides & Controller Positioning

Video Speed Controller uses a layered CSS system to position the speed controller overlay across thousands of sites. This guide explains how the layers work, how to write site-specific overrides, and how to customize the controller from the options page.

## How the controller is styled

There are three CSS layers, applied in order:

| Layer | Source | Loaded by | Purpose |
|---|---|---|---|
| **Base** | `src/styles/inject.css` | Manifest (`content_scripts.css`) | Default layout: `position: absolute`, visibility, sizing |
| **Site overrides** | `src/styles/controller-css-defaults.js` | `content-entry.js` (before `inject.js`) | Per-site positioning tweaks |
| **User CSS** | Options page "Controller CSS" field | `content-entry.js` (live-updated) | User customization |

The base layer is loaded via the manifest, which guarantees it is available before any JavaScript runs. Site overrides and user CSS are injected as a `<style>` element before the controller is created, so rules are always in place before the first paint.

## The `<vsc-controller>` element

The controller is a custom element with a shadow DOM:

```
<vsc-controller style="z-index: 9999999 !important">
  #shadow-root (open)
    <style>...</style>          ← scoped inner styles
    <div id="controller">       ← visible pill (black background, rounded)
      <span class="draggable">1.00</span>
      <span id="controls">...</span>
    </div>
</vsc-controller>
```

**Outer element** (`vsc-controller`) — controlled by page CSS (the three layers above). Determines *where* the controller sits relative to the video.

**Inner element** (`#controller`) — inside shadow DOM, isolated from page styles. Determines *what* the controller looks like (colors, padding, font).

When you write CSS overrides you are styling the **outer element**. You cannot reach inside the shadow DOM from page CSS — that is by design.

## Positioning modes

The base rule sets `position: absolute`, which places the controller at the top-left corner of its nearest positioned ancestor. This works well on most sites. For sites where the controller lands in the wrong spot, you switch to `position: relative` and nudge it with `top` / `left`.

### Absolute (default)

The extension calculates the controller's coordinates by comparing the video's bounding rect to its offset parent. No CSS override needed — it just works.

### Relative (site override)

When a site's DOM structure makes absolute positioning unreliable (overlapping elements, unusual stacking contexts), switch to relative and offset manually:

```css
:root[style*='--vsc-domain: "example.com"'] vsc-controller {
  position: relative;
  top: 40px;
}
```

The controller flows in the normal document order and you control where it appears with `top` and `left`.

## Writing domain-based rules

Domain rules use the `--vsc-domain` CSS variable, which `content-entry.js` sets on `:root` before any CSS is injected. The variable holds the bare hostname with `www.` stripped.

### Selector pattern

```css
:root[style*='--vsc-domain: "HOSTNAME"'] vsc-controller {
  /* overrides */
}
```

Replace `HOSTNAME` with the bare domain — `facebook.com`, not `www.facebook.com`.

### Example: push controller below a site's toolbar

```css
:root[style*='--vsc-domain: "example.com"'] vsc-controller {
  position: relative;
  top: 60px;
}
```

### Example: shift controller right to avoid a logo

```css
:root[style*='--vsc-domain: "example.com"'] vsc-controller {
  position: relative;
  top: 10px;
  left: 50px;
}
```

### Example: prevent black overlay on fullscreen

Some sites have containers that stretch the controller to cover the video. Fix with:

```css
.site-fullscreen-class vsc-controller {
  height: 0 !important;
}
```

## Writing DOM-contextual rules

When domain alone is not enough — for example, the same site has different layouts for embedded vs. fullscreen — you can target DOM structure:

```css
/* YouTube embedded player (on third-party sites) */
.html5-video-player:not(.ytp-hide-info-bar) vsc-controller {
  position: relative;
  top: 60px;
}
```

These rules are less stable because they depend on the site's class names, which can change without notice. Prefer domain-based rules when possible.

## Existing overrides reference

These are the built-in overrides shipped with the extension (in `controller-css-defaults.js`):

| Site | What the override does |
|---|---|
| Facebook | `position: relative; top: 40px` — below the video player chrome |
| Google Photos (inline) | `position: relative; top: 35px` |
| Google Photos (full-screen) | `top: 50px` — extra offset for larger view |
| Netflix | `position: relative; top: 85px` — below the title overlay |
| Google Drive | `position: relative; top: 10px` |
| ChatGPT | `position: relative; top: 0; left: 35px` — right of the play button |
| YouTube (info bar hidden) | `position: relative; top: 10px` |
| YouTube (paid promotion visible) | `top: 40px` — below the promotion overlay |
| YouTube (embedded) | `position: relative; top: 60px` |
| OpenAI / Amazon Prime (fullscreen) | `height: 0 !important` — prevents black overlay |

## Customizing from the options page

Users can edit controller CSS directly from the extension's options page:

1. Right-click the extension icon → **Options** (or go to `chrome://extensions` → Video Speed Controller → Details → Extension options).
2. Find the **Controller CSS** text area.
3. Edit the CSS. Changes apply immediately — no page reload needed.

The options page is pre-filled with `DEFAULT_CONTROLLER_CSS` from `controller-css-defaults.js`. You can modify existing rules, add new domain rules, or delete rules you don't need.

### Tips

- **Test in DevTools first.** Open the Elements panel, find the `<vsc-controller>` element, and experiment with styles before committing them to the options page.
- **Use the `--vsc-domain` variable.** It is the most stable selector. DOM-contextual selectors break when sites change their markup.
- **Don't use `!important` unless necessary.** The only built-in inline style is `z-index`. Position, top, and left are all set via CSS, so normal specificity wins.
- **Reload the page** after editing if the controller was already positioned (drag offsets are cached per session).

## How controller insertion works (for handler authors)

When a `VideoController` is created, it calls `siteHandlerManager.getControllerPosition(parent, video)` to decide where to insert the `<vsc-controller>` element. The handler returns:

```js
{
  insertionPoint: element,       // where to insert
  insertionMethod: 'firstChild', // 'firstChild', 'beforeParent', or 'afterParent'
  targetParent: element,         // positioning context
}
```

After insertion, the extension checks the **computed** `position` of the wrapper:
- If **absolute** → calculates `top`/`left` for the inner `#controller` based on the video's bounding rect vs. offset parent.
- If **relative** → relies entirely on CSS `top`/`left` from the override rules.

This is why switching a domain to `position: relative` in CSS is all you need — the extension skips its coordinate calculation and defers to your CSS offsets.

### Insertion methods

| Method | Behavior |
|---|---|
| `firstChild` | Prepends `<vsc-controller>` as the first child of `insertionPoint` |
| `beforeParent` | Inserts `<vsc-controller>` before `insertionPoint` in its parent |
| `afterParent` | Inserts `<vsc-controller>` after `insertionPoint` in its parent |

Choose the method that places the controller in the right stacking context. If the video has overlays that cover it, inserting *before* the video's container often solves z-index issues without needing `!important`.

## Adding a new site override

To add a built-in override for a site:

1. Open the site and inspect the video player's DOM structure.
2. Determine if `position: relative` with `top`/`left` offsets will work, or if you need a DOM-contextual selector.
3. Add the rule to `src/styles/controller-css-defaults.js`:

```js
export const DEFAULT_CONTROLLER_CSS = `/* existing rules... */

/* New Site */
:root[style*='--vsc-domain: "newsite.com"'] vsc-controller {
  position: relative;
  top: 50px;
}`;
```

4. If the site also needs a custom insertion point, create a site handler (see [Custom Player Handler Guide](./custom-player-handler.md)).

Rules in `controller-css-defaults.js` are the *defaults* — users who have customized their CSS in the options page won't see new rules until they reset to defaults.

## Troubleshooting

**Controller is invisible**
- Check if a parent element has `overflow: hidden` clipping the controller.
- Look for the `vsc-hidden` or `vsc-nosource` class on `<vsc-controller>`.

**Controller appears but in the wrong position**
- Inspect the computed `position` on `<vsc-controller>`. If it's `absolute`, the coordinate calculation may be wrong — try switching to `relative` with explicit offsets.
- Check if the site dynamically moves the video element after page load.

**Controller causes a black overlay**
- The `<vsc-controller>` may be stretching to fill its container. Add `height: 0 !important` for that context.

**CSS changes from options page don't take effect**
- The `<style id="vsc-controller-css">` element should update live. If it doesn't, check the console for storage errors.
- If a drag offset was applied during the session, it may override CSS positioning. Reload the page.
