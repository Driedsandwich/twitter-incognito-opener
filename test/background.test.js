'use strict';

// background.js（service worker）を、偽の chrome API の上で実際に走らせて確かめる。
//
// ここで見るのは「外から観測できる振る舞い」だけ——どの API を、どの引数で呼んだか。
// Chrome の内部実装は模倣しない。実ブラウザでの確認は SMOKE.md の担当。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const BACKGROUND_SRC = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const MENU_ID = 'open-in-incognito';
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(options = {}) {
  const calls = {
    imported: [],
    menusCreated: [],
    tabsSendMessage: [],
    executeScript: [],
    windowsCreate: [],
  };
  const listeners = { installed: [], startup: [], clicked: [], message: [] };

  const chrome = {
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    contextMenus: {
      onClicked: { addListener: (fn) => listeners.clicked.push(fn) },
      removeAll: (cb) => cb(),
      create: (opts) => calls.menusCreated.push(opts),
    },
    i18n: { getMessage: (key) => `msg:${key}` },
    tabs: {
      sendMessage: (tabId, msg, opts) => {
        calls.tabsSendMessage.push({ tabId, msg, opts });
        if (msg.type === 'getContextTarget') {
          return options.sendMessageRejects
            ? Promise.reject(new Error('Receiving end does not exist'))
            : Promise.resolve(options.contextResponse || { url: null });
        }
        if (msg.type === 'clearContextTarget' && options.clearRejects) {
          return Promise.reject(new Error('Receiving end does not exist'));
        }
        return Promise.resolve();
      },
    },
    scripting: {
      executeScript: (arg) => {
        calls.executeScript.push(arg);
        return Promise.resolve();
      },
    },
    windows: {
      create: (arg) => {
        calls.windowsCreate.push(arg);
        return options.windowsCreateRejects
          ? Promise.reject(new Error('Incognito mode is disabled'))
          : Promise.resolve({ id: 1 });
      },
    },
  };

  const sandbox = {
    chrome,
    // 例外経路のログでテスト出力を汚さない
    console: { error() {}, warn() {}, log() {} },
    URL,
    setTimeout,
    clearTimeout,
  };
  const ctx = vm.createContext(sandbox);
  ctx.importScripts = (rel) => {
    calls.imported.push(rel);
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  };
  vm.runInContext(BACKGROUND_SRC, ctx, { filename: 'background.js' });

  return {
    calls,
    ctx,
    installMenu: () => listeners.installed[0](),
    clickMenu: (info, tab) => listeners.clicked[0](info, tab),
    sendRuntime: (msg, sender) => listeners.message[0](msg, sender),
    notifications: () => calls.tabsSendMessage.filter((c) => c.msg.type === 'notify'),
  };
}

test('service worker は post-url.js を読み込み、共有パーサーを使える', () => {
  const h = harness();
  assert.deepEqual([...h.calls.imported], ['post-url.js']);
  assert.equal(typeof h.ctx.PostCloakUrl.toPostUrl, 'function');
});

test('メニューは4つのホストにだけ出し、広いパターンを使わない', () => {
  const h = harness();
  h.installMenu();
  assert.equal(h.calls.menusCreated.length, 1);
  const opts = h.calls.menusCreated[0];
  assert.deepEqual([...opts.documentUrlPatterns].sort(), [
    'https://twitter.com/*',
    'https://www.twitter.com/*',
    'https://www.x.com/*',
    'https://x.com/*',
  ]);
  for (const pattern of opts.documentUrlPatterns) {
    assert.ok(!pattern.includes('*.'), `サブドメインのワイルドカード: ${pattern}`);
    assert.notEqual(pattern, '<all_urls>');
  }
  // "all" は拡張アイコンの右クリックも含み、そこには documentUrlPatterns が効かない
  assert.ok(!opts.contexts.includes('all'), 'contexts に "all" を使っている');
});

test('右クリックしたリンクがポストなら、正規化してそのまま開く', async () => {
  const h = harness();
  await h.clickMenu(
    { menuItemId: MENU_ID, linkUrl: 'https://x.com/alice/status/123/photo/1?s=20', frameId: 0 },
    { id: 7 }
  );
  assert.equal(h.calls.windowsCreate.length, 1);
  assert.equal(h.calls.windowsCreate[0].url, 'https://x.com/alice/status/123');
  assert.equal(h.calls.windowsCreate[0].incognito, true);

  // 割り出しは頼まないが、直前の右クリックで控えられた値は消してもらう
  const types = h.calls.tabsSendMessage.map((c) => c.msg.type);
  assert.deepEqual(types, ['clearContextTarget'], '送ったメッセージが想定と違う');
  assert.equal(h.calls.tabsSendMessage[0].tabId, 7);
  assert.equal(h.calls.tabsSendMessage[0].opts.frameId, 0);
});

test('控えた値の消去に失敗しても、直接リンクは開く', async () => {
  const h = harness({ clearRejects: true });
  await h.clickMenu(
    { menuItemId: MENU_ID, linkUrl: 'https://x.com/alice/status/123', frameId: 0 },
    { id: 7 }
  );
  assert.equal(h.calls.windowsCreate.length, 1, '消去の失敗で開けなくなった');
  assert.equal(h.calls.executeScript.length, 0, 'content script を入れ直してしまった');
  const notifies = h.calls.tabsSendMessage.filter((c) => c.msg.type === 'notify');
  assert.equal(notifies.length, 0, '画面に断りを出してしまった');
});

test('リンクがポストでないときは、content script に割り出させる', async () => {
  const h = harness({ contextResponse: { url: 'https://x.com/bob/status/999' } });
  await h.clickMenu(
    { menuItemId: MENU_ID, linkUrl: 'https://example.com/article', frameId: 3 },
    { id: 7 }
  );
  assert.equal(h.calls.tabsSendMessage.length, 1);
  assert.equal(h.calls.tabsSendMessage[0].msg.type, 'getContextTarget');
  assert.equal(h.calls.tabsSendMessage[0].tabId, 7);
  // 右クリックされたフレームを名指しで呼ぶ
  assert.equal(h.calls.tabsSendMessage[0].opts.frameId, 3);
  assert.equal(h.calls.windowsCreate.length, 1);
  assert.equal(h.calls.windowsCreate[0].url, 'https://x.com/bob/status/999');
});

test('content script から返った URL も、開く前に検証し直す', async () => {
  const h = harness({ contextResponse: { url: 'https://evil.example/alice/status/1' } });
  await h.clickMenu({ menuItemId: MENU_ID, frameId: 0 }, { id: 7 });
  assert.equal(h.calls.windowsCreate.length, 0, '検証せずに開いてしまった');
});

test('content script がいないときは、順序どおり入れ直して案内を出す', async () => {
  const h = harness({ sendMessageRejects: true });
  await h.clickMenu({ menuItemId: MENU_ID, frameId: 0 }, { id: 7 });
  assert.equal(h.calls.executeScript.length, 1);
  assert.deepEqual([...h.calls.executeScript[0].files], ['post-url.js', 'content.js']);
  assert.deepEqual([...h.calls.executeScript[0].target.frameIds], [0]);
  assert.equal(h.calls.windowsCreate.length, 0, 'この回はウィンドウを開かない');
  const notify = h.notifications();
  assert.equal(notify.length, 1);
  assert.equal(notify[0].msg.text, 'msg:errorRetryNeeded');
});

test('別のメニュー項目やタブの無いクリックには反応しない', async () => {
  const h = harness();
  await h.clickMenu({ menuItemId: 'other', linkUrl: 'https://x.com/alice/status/123' }, { id: 7 });
  await h.clickMenu({ menuItemId: MENU_ID, linkUrl: 'https://x.com/alice/status/123' }, undefined);
  await h.clickMenu({ menuItemId: MENU_ID, linkUrl: 'https://x.com/alice/status/123' }, {});
  assert.equal(h.calls.windowsCreate.length, 0);
});

test('Shift+Alt 経由のメッセージでも URL を検証し直す', () => {
  const h = harness();
  h.sendRuntime(
    { type: 'open', url: 'https://x.com/alice/status/123?s=20' },
    { tab: { id: 5 }, frameId: 0 }
  );
  assert.equal(h.calls.windowsCreate.length, 1);
  assert.equal(h.calls.windowsCreate[0].url, 'https://x.com/alice/status/123');
});

test('送り主のタブが分からないメッセージと、ポストでない URL は無視する', () => {
  const h = harness();
  h.sendRuntime({ type: 'open', url: 'https://x.com/alice/status/123' }, {});
  for (const url of [
    'https://evil.example/alice/status/1',
    'https://x.com/alice/status/123/evil',
    'https://alice:secret@x.com/alice/status/123',
    'javascript:alert(1)',
    undefined,
  ]) {
    h.sendRuntime({ type: 'open', url }, { tab: { id: 5 }, frameId: 0 });
  }
  assert.equal(h.calls.windowsCreate.length, 0);
});

test('シークレットウィンドウを開けなかったときは、画面に知らせる', async () => {
  const h = harness({ windowsCreateRejects: true });
  h.sendRuntime(
    { type: 'open', url: 'https://x.com/alice/status/123' },
    { tab: { id: 5 }, frameId: 0 }
  );
  await flush();
  const notify = h.notifications();
  assert.equal(notify.length, 1);
  assert.equal(notify[0].msg.text, 'msg:errorIncognitoUnavailable');
});
