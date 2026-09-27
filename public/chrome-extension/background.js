// AdSpy Pro — Ad Collector background service worker.
// Currently a no-op placeholder — all submission logic lives in content.js.
// Reserved for future features (badge counts, alarms, etc).
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["adspyEnabled"], (result) => {
    if (result.adspyEnabled === undefined) {
      chrome.storage.local.set({ adspyEnabled: true });
    }
  });
});
