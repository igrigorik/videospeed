let savedTimerFormatDuration = function(ms) {
  let seconds = ms / 1000;
  let h = Math.floor(seconds/3600);
  let m = Math.floor((seconds - 3600*h) / 60);
  let s = Math.floor(seconds - 3600*h - 60*m);
  console.info(`saved duration: ${h}h:${m}m:${s}s`);
  if (h === 0 && m === 0) {
    return `${s}s`;
  } else {
    return `${m}m`;
  }
}

let savedTimerReset = function() {
  chrome.storage.sync.remove('saved_durations');
}

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    let vscid = request.vscid;

    chrome.storage.sync.get({saved_durations: {}}, function(store) {
      if(store.saved_durations[vscid] == null)
        store.saved_durations[vscid] = 0;

      if(request.stillPlaying) {
        store.saved_durations["stillPlaying."+vscid] = request.duration;
      } else {
        store.saved_durations[vscid] = store.saved_durations[vscid] + request.duration;
        delete store.saved_durations["stillPlaying."+vscid];
      }

      let sum = 0;
      Object
        .values(store.saved_durations)
        .forEach(d => sum += d);

      chrome.storage.sync.set(store);
      chrome.browserAction.setBadgeText({text: savedTimerFormatDuration(sum)});
    });
  },
);
