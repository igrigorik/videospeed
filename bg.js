chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    if (request.vscKeyCode)
      chrome.tabs.sendMessage(sender.tab.id,{"vscKeyCode": request.vscKeyCode});
  });