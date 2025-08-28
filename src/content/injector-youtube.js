(() => {
    const oldSetTimeout = window.setTimeout;
    window.setTimeout = (f, delay = 0, ...args) => {
        // Changing all `setTimeout`s might cause other problems and
        // only subtitles are not rounded so this will be enough for not breaking anything.
        if (delay % 10 !== 0) {
            // Make YouTube update captions 4x as frequent so it can
            // keep up with Video Speed Controller
            delay /= 4;
        }
        return oldSetTimeout(f, delay, ...args);
    };
})();
