/**
 * Simple Module Loader for Chrome Extensions
 * Provides ES6-like module functionality without actual ES6 modules
 */

window.VSC_MODULES = window.VSC_MODULES || {};

// Module registry
const moduleRegistry = new Map();
const modulePromises = new Map();

/**
 * Define a module (replaces export)
 */
window.defineModule = function (name, dependencies, factory) {
  if (typeof dependencies === 'function') {
    factory = dependencies;
    dependencies = [];
  }

  const modulePromise = Promise.all(
    dependencies.map(dep => loadModule(dep))
  ).then(deps => {
    const module = { exports: {} };
    const result = factory.apply(null, [module, ...deps]);
    // If factory returns something, use that, otherwise use module.exports
    const moduleExports = result !== undefined ? result : module.exports;
    moduleRegistry.set(name, moduleExports);
    return moduleExports;
  });

  modulePromises.set(name, modulePromise);
  return modulePromise;
};

/**
 * Load a module (replaces import)
 */
window.loadModule = function (name) {
  if (moduleRegistry.has(name)) {
    return Promise.resolve(moduleRegistry.get(name));
  }

  if (modulePromises.has(name)) {
    return modulePromises.get(name);
  }

  // If module not loaded, try to load it as a script
  const modulePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      script.src = chrome.runtime.getURL(`src/${name}.js`);
    } else {
      script.src = `src/${name}.js`;
    }
    script.onload = () => {
      // Module should have defined itself
      if (modulePromises.has(name)) {
        modulePromises.get(name).then(resolve).catch(reject);
      } else {
        reject(new Error(`Module ${name} did not define itself`));
      }
    };
    script.onerror = () => reject(new Error(`Failed to load module: ${name}`));
    document.head.appendChild(script);
  });

  modulePromises.set(name, modulePromise);
  return modulePromise;
};

window.VSC.logger.debug('Module loader initialized');