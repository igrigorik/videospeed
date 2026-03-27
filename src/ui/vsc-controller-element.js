/**
 * The <vsc-controller> element is used as an unregistered custom element.
 * Browsers allow any hyphenated tag name via document.createElement() without
 * calling customElements.define(). This avoids conflicts with third-party
 * custom-elements-es5-adapter polyfills that monkey-patch customElements.define()
 * and break native ES6 class constructors (see #1458).
 *
 * No registration is needed — CSS selectors, querySelector, shadow DOM, and
 * tagName all work on unregistered hyphenated elements.
 */
