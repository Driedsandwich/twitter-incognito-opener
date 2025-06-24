document.addEventListener('click', function (e) {
  if (!e.shiftKey || !e.altKey) return;

  let target = e.target;
  let anchor = null;

  while (target) {
    if (target.tagName === 'A' && target.href && target.href.includes('/status/')) {
      anchor = target;
      break;
    }
    if (target.tagName === 'ARTICLE') {
      anchor = target.querySelector('a[href*="/status/"]');
      break;
    }
    target = target.parentElement;
  }

  if (anchor && anchor.getAttribute('href').startsWith('/')) {
    e.preventDefault();
    const fullUrl = window.location.origin + anchor.getAttribute('href');
    chrome.runtime.sendMessage({ url: fullUrl });
  }
}, true);
