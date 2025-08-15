/**
 * Custom element for the video speed controller
 * Uses Web Components to avoid CSS conflicts with page styles
 */

window.VSC = window.VSC || {};

class VSCControllerElement extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    // Element is now connected to the DOM
    // Set styles here instead of constructor
    this.style.display = 'block';
    this.style.width = 'auto';
    this.style.height = 'auto';

    window.VSC.logger?.debug('VSC custom element connected to DOM');
  }

  disconnectedCallback() {
    // Cleanup when element is removed
    window.VSC.logger?.debug('VSC custom element disconnected from DOM');
  }

  static register() {
    // Define the custom element if not already defined
    if (!customElements.get('vsc-controller')) {
      customElements.define('vsc-controller', VSCControllerElement);
      window.VSC.logger?.info('VSC custom element registered');
    }
  }
}

// Export the class
window.VSC.VSCControllerElement = VSCControllerElement;

// Auto-register when the script loads
VSCControllerElement.register();
