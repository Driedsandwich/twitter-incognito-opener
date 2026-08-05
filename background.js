// PostCloak – background.js（service worker）
// 右クリックメニューを出し、content script が割り出したポストURLを
// シークレットウィンドウで開く。URL の割り出しは content script 側の担当。

// URL の判定は content script と共有する。service worker は module 指定を
// していない古典形なので、importScripts で読める。
importScripts('post-url.js');

const MENU_ID = 'open-in-incognito';

// メニューを出す画面。ここを絞らないと、無関係な全サイトの右クリックに項目が出る。
//
// サブドメインのワイルドカード（*.x.com）は使わない。documentUrlPatterns の照合対象は
// ページではなく「右クリックされたフレームのURL」なので、ワイルドカードにすると
// 第三者のブログに埋め込まれたポスト（platform.twitter.com の iframe）にも項目が出る。
// そこには content script がいないので、押しても何も起きない項目になってしまう。
const TARGET_PAGES = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://twitter.com/*',
  'https://www.twitter.com/*',
];

/* ---------- メニューの登録 ---------- */

// contexts に "all" は使わない。"all" は拡張アイコンの右クリックメニューも含み、
// そちらには documentUrlPatterns が適用されないため、
// 「どのサイトでも出るのに押しても何も起きない項目」が残ってしまう。
const MENU_CONTEXTS = ['page', 'selection', 'link', 'image', 'video', 'audio'];

// onInstalled だけだと、ブラウザ再起動後に service worker が起きたときに
// 二重登録の例外が出ることがあるため、作り直しに寄せる。
function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage('menuOpenInIncognito'),
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: TARGET_PAGES,
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

/* ---------- メニューが押されたとき ---------- */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  // tab は公式に optional。開発者ツールなど、タブを伴わない場面では届かない。
  const tabId = tab && tab.id;
  if (typeof tabId !== 'number') return;

  // 右クリックされたフレームを名指しで呼ぶ。指定しないと、
  // どのフレームで右クリックしてもトップフレームが答えることになる。
  const frameId = typeof info.frameId === 'number' ? info.frameId : 0;

  // リンクの上で右クリックした場合、それがポストのURLならそのまま使う。
  // ポスト以外のリンク（プロフィール、外部サイト）は使わず、
  // content script に「そのリンクが載っているポスト」を割り出させる。
  const direct = PostCloakUrl.toPostUrl(info.linkUrl);
  if (direct) {
    openIncognito(direct, tabId, frameId);
    return;
  }

  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: 'getContextTarget' }, { frameId });
  } catch (e) {
    // 拡張のインストール・更新より前から開いていたタブには content script がいない
    // （Chrome は既存タブへ遡って注入しない）。黙って何も起きないのが旧実装の
    // いちばん困る挙動だったので、その場で入れ直したうえで画面にも出す。
    await reviveContentScript(tabId, frameId);
    return;
  }

  // URL が無いときの画面への通知は content script 側が出している（この応答の前に）。
  if (res && res.url) openIncognito(res.url, tabId, frameId);
});

// content script を入れ直し、「もう一度どうぞ」を画面に出す。
// 右クリックはもう終わっているので、この回の操作は完了できない。
async function reviveContentScript(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      // manifest の content_scripts と同じ順序で入れる。content.js は
      // post-url.js が先に入っていることを前提にしている。
      files: ['post-url.js', 'content.js'],
    });
    await chrome.tabs.sendMessage(
      tabId,
      { type: 'notify', text: chrome.i18n.getMessage('errorRetryNeeded') },
      { frameId }
    );
  } catch (e) {
    console.warn('[PostCloak] content script を入れ直せませんでした:', e);
  }
}

/* ---------- Shift+Alt クリックから ---------- */

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'open') return false;
  const url = PostCloakUrl.toPostUrl(msg.url);
  // 送り主のタブ以外からのメッセージは扱わない。
  if (url && sender.tab && typeof sender.tab.id === 'number') {
    openIncognito(url, sender.tab.id, sender.frameId);
  }
  return false;
});

/* ---------- シークレットウィンドウを開く ---------- */

// 拡張が「シークレット モードでの実行を許可」を持っていなくても、
// ウィンドウ自体は開く（戻り値が null になるだけ）。
// 開けないのは、シークレットモードが組織のポリシー等で無効化されている場合。
// 旧実装は失敗を握り潰していたので、ここでは必ず利用者へ返す。
//
// 開くのは常にあたらしいウィンドウ。既存のシークレットウィンドウへタブを足す実装は
// 持っていないので、「シークレット モードでの実行を許可」を利用者がオンにしても
// この挙動は変わらない（オンにすると増えるのは拡張の権限だけ）。文書もそう書くこと。
async function openIncognito(url, tabId, frameId) {
  try {
    await chrome.windows.create({ url, incognito: true });
  } catch (e) {
    console.error('[PostCloak] シークレットウィンドウを開けませんでした:', e);
    tell(tabId, frameId, chrome.i18n.getMessage('errorIncognitoUnavailable'));
  }
}

function tell(tabId, frameId, text) {
  const opts = typeof frameId === 'number' ? { frameId } : undefined;
  chrome.tabs.sendMessage(tabId, { type: 'notify', text }, opts).catch(() => {});
}
