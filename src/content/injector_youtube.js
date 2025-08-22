(() => {
    const oldSetTimeout = window.setTimeout;
    window.setTimeout = (f, delay = 0, ...args) => {
        // Make YouTube update captions 4x as frequent so it can
        // keep up with Video Speed Controller
        delay /= 4;
        return oldSetTimeout(f, delay, ...args);
    };
})();
