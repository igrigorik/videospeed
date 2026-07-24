/**
 * Default CSS for controller site-specific positioning overrides.
 *
 * Base vsc-controller rule lives in inject.css (manifest-loaded).
 * This module contains site-specific overrides that layer on top.
 *
 * Domain selectors use :root[style*='--vsc-domain: "DOMAIN"'] syntax.
 * At injection time, matching domains get the selector stripped (rule
 * applies unconditionally); non-matching get [data-vsc-never] (never
 * matches). No CSS variable is actually set on :root.
 */

export const DEFAULT_CONTROLLER_CSS = `/* === Domain-based rules (stable — hostname only) === */

/* Facebook */
:root[style*='--vsc-domain: "facebook.com"'] vsc-controller {
  position: relative;
  top: 40px;
}

/* Google Photos — inline preview */
:root[style*='--vsc-domain: "photos.google.com"'] vsc-controller {
  position: relative;
  top: 35px;
}

/* Google Photos — full-screen view */
:root[style*='--vsc-domain: "photos.google.com"'] #player .house-brand vsc-controller {
  top: 50px;
}

/* Netflix */
:root[style*='--vsc-domain: "netflix.com"'] vsc-controller {
  position: relative;
  top: 85px;
}

/* Google Drive — shift native controls overlay down to expose video */
:root[style*='--vsc-domain: "drive.google.com"'] section[role="tabpanel"][aria-label="Video Player"] {
  top: 80px;
}

/* ChatGPT */
:root[style*='--vsc-domain: "chatgpt.com"'] vsc-controller {
  position: relative;
  top: 0px;
  left: 35px;
}

/* === DOM-contextual rules (may break if site changes HTML structure) === */

/* YouTube — controller can be inside .html5-video-player (main site via
   youtube-handler) or a sibling of it (edge cases). Both selectors needed;
   :has(> ...) handles the sibling case DOM-order-independently. Domain-
   wrapped (marker on the first selector scopes the whole rule) so the
   :has() probe never evaluates off-YouTube (#1501); the duplicate block
   covers youtube-nocookie.com, the privacy-enhanced embed host serving the
   identical player. */
:root[style*='--vsc-domain: "youtube.com"'] .ytp-hide-info-bar > vsc-controller,
:has(> .ytp-hide-info-bar) > vsc-controller {
  position: relative;
  top: 10px;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] .ytp-hide-info-bar > vsc-controller,
:has(> .ytp-hide-info-bar) > vsc-controller {
  position: relative;
  top: 10px;
}

/* YouTube — shifts below paid promotion overlay when visible.
   Domain-wrapped so preprocessDomainCSS strips it on non-YouTube pages:
   [style*=...] forces global style invalidation on every style mutation,
   causing multi-second hangs on heavy pages (Gemini, etc). (#1501) */
:root[style*='--vsc-domain: "youtube.com"'] .ytp-hide-info-bar:has(.ytp-paid-content-overlay-link:not([style*="display: none"])) > vsc-controller,
:has(> .ytp-hide-info-bar .ytp-paid-content-overlay-link:not([style*="display: none"])) > vsc-controller {
  top: 40px;
}

/* YouTube embedded player — title-bar clearance across all insertion
   generations: inside the player (classic), promoted to #player (older
   #player-controls sibling layout), and body-anchored (2026 ytm layout,
   where youtube-handler escapes the #movie_player stacking context and the
   never-cleared ytp-autohide coupling). position:relative keeps the
   deterministic 0,0 inner placeholder (VideoController skips rect math for
   relative hosts). Domain-wrapped so the :has()/#player probes never
   evaluate off-YouTube (#1501); previously the bare #player rule applied a
   60px offset on ANY site with a #player container. The duplicate block
   covers youtube-nocookie.com privacy-enhanced embeds. */
:root[style*='--vsc-domain: "youtube.com"'] .html5-video-player:not(.ytp-hide-info-bar) > vsc-controller,
:has(> .html5-video-player:not(.ytp-hide-info-bar)) > vsc-controller,
#player > vsc-controller,
body:has(> #player-controls) > vsc-controller {
  position: relative;
  top: 60px;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] .html5-video-player:not(.ytp-hide-info-bar) > vsc-controller,
:has(> .html5-video-player:not(.ytp-hide-info-bar)) > vsc-controller,
#player > vsc-controller,
body:has(> #player-controls) > vsc-controller {
  position: relative;
  top: 60px;
}

/* OpenAI — prevent black overlay */
.Shared-Video-player > vsc-controller {
  height: 0 !important;
}

/* Amazon Prime Video — prevent black overlay */
.dv-player-fullscreen vsc-controller {
  height: 0 !important;
}

/* Google Drive YouTube embed — no info bar, override embedded player offset.
   Extra :root bumps specificity above .html5-video-player:not(...) rule. */
:root:root[style*='--vsc-domain: "youtube.googleapis.com"'] vsc-controller {
  position: relative;
  top: 0px;
}`;
