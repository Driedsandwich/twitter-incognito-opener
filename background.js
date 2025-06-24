chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-in-incognito",
    title: "ｼｰｸﾚｯﾄｳｨﾝﾄﾞｳで開く(Shift+Alt)(URL自動検出)",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-in-incognito") {
    if (info.linkUrl) {
      chrome.windows.create({
        url: info.linkUrl,
        incognito: true
      });
    } else {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = window.getSelection();
          const article = sel.anchorNode?.parentElement?.closest('article');
          const link = article?.querySelector('a[href*="/status/"]');
          if (link) {
            chrome.runtime.sendMessage({ url: location.origin + link.getAttribute("href") });
          } else {
            alert("開けるリンクが見つかりませんでした。");
          }
        }
      });
    }
  }
});

chrome.runtime.onMessage.addListener(({ url }) => {
  if (url) {
    chrome.windows.create({
      url: url,
      incognito: true
    });
  }
});
