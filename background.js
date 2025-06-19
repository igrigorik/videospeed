chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    createContextMenu();
  }
});

chrome.storage.sync.onChanged.addListener(function (changes) {
  if (changes.contextMenuBoolean) {
    if (changes.contextMenuBoolean.newValue) {
      createContextMenu();
    }
    else {
      chrome.contextMenus.removeAll();
    }
  }
});

chrome.contextMenus.onClicked.addListener((info, tabs) => {
  chrome.tabs.sendMessage(
    tabs.id,
    info.menuItemId
  );
});  

function createContextMenu() {
  chrome.contextMenus.create({
    id: 'slow-down-01',
    title: 'Slow down (x0.1)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'slow-down-02',
    title: 'Slow down (x0.2)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'slow-down-04',
    title: 'Slow down (x0.4)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'slow-down-06',
    title: 'Slow down (x0.6)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'slow-down-08',
    title: 'Slow down (x0.8)',
    contexts: ['all']
  });

  chrome.contextMenus.create({
    id: 'speed-up-12',
    title: 'Speed up (x1.2)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'speed-up-14',
    title: 'Speed up (x1.4)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'speed-up-16',
    title: 'Speed up (x1.6)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'speed-up-18',
    title: 'Speed up (x1.8)',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'speed-up-20',
    title: 'Speed up (x2.0)',
    contexts: ['all']
  });
}
