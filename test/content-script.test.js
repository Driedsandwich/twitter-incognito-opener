'use strict';

// content.js を、最小限の偽 DOM と偽 chrome の上で実際に走らせて確かめる。
//
// ここで確かめられるのは「同じ文脈へ2回読み込んだときの振る舞い」までで、
// Chrome が実際に既存タブへ入れ直したときの挙動そのものではない。
// 実ブラウザでの確認項目は SMOKE.md にある。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PARSER_SRC = fs.readFileSync(path.join(ROOT, 'post-url.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    style: {},
    textContent: '',
    isConnected: false,
    parentElement: null,
    _attrs: {},
    setAttribute(key, value) {
      this._attrs[key] = value;
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null;
    },
    remove() {
      this.isConnected = false;
    },
  };
}

// <article> の中に「<time> を包むパーマリンク」が1本ある形だけを作る。
// 本物の querySelector は実装せず、content.js が投げてくる2種類のセレクタに答える。
function makeArticle(href) {
  const article = makeEl('article');
  const link = makeEl('a');
  link.setAttribute('href', href);
  const time = makeEl('time');
  time.closest = () => link;
  article.querySelector = (selector) => (selector.includes('time') ? time : link);
  return article;
}

function harness() {
  const created = [];
  const domListeners = [];
  const runtimeListeners = [];
  const sent = [];

  const html = makeEl('html');
  const body = makeEl('body');
  body.parentElement = html;
  body.appendChild = (el) => {
    el.isConnected = true;
    return el;
  };

  const document = {
    documentElement: html,
    body,
    createElement(tag) {
      const el = makeEl(tag);
      created.push(el);
      return el;
    },
    addEventListener(type, fn, capture) {
      domListeners.push({ type, fn, capture });
    },
  };

  const chrome = {
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      onMessage: {
        addListener(fn) {
          runtimeListeners.push(fn);
        },
      },
      sendMessage(payload) {
        sent.push(payload);
        return Promise.resolve();
      },
    },
    i18n: { getMessage: (key) => `msg:${key}` },
  };

  const sandbox = {
    document,
    chrome,
    console,
    location: { href: 'https://x.com/home' },
    Node: { TEXT_NODE: 3 },
    URL,
    // 4秒後の消去をそのまま仕掛けるとテストが待たされるので、記録だけする
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);

  return {
    html,
    created,
    domListeners,
    runtimeListeners,
    sent,
    sandbox,
    load() {
      this.loadParser();
      this.loadContent();
    },
    // post-url.js と content.js は別々に読めるようにしておく。
    // 「依存が入らなかった回」を再現するため。
    loadParser() {
      vm.runInContext(PARSER_SRC, ctx, { filename: 'post-url.js' });
    },
    loadContent() {
      vm.runInContext(CONTENT_SRC, ctx, { filename: 'content.js' });
    },
    fire(type, event) {
      for (const l of domListeners) if (l.type === type) l.fn(event);
    },
    ask(message) {
      let response;
      for (const fn of runtimeListeners) fn(message, {}, (r) => (response = r));
      return response;
    },
    // <article> の中の要素を1つ作って文書につなぐ
    postElement(href) {
      const article = makeArticle(href);
      article.parentElement = html;
      const span = makeEl('span');
      span.parentElement = article;
      return span;
    },
    strayElement() {
      const div = makeEl('div');
      div.parentElement = html;
      return div;
    },
    // ポストの外に置いた <a>。Shift+Alt クリックの分岐を見るために使う。
    linkElement(href) {
      const a = makeEl('a');
      a.setAttribute('href', href);
      a.parentElement = html;
      return a;
    },
  };
}

test('同じ版を2回読み込んでも、登録される listener は1組だけ', () => {
  const h = harness();
  h.load();
  const afterFirst = { dom: h.domListeners.length, runtime: h.runtimeListeners.length };
  h.load();
  assert.equal(h.domListeners.length, afterFirst.dom, 'DOM の listener が増えた');
  assert.equal(h.runtimeListeners.length, afterFirst.runtime, 'runtime の listener が増えた');
  // 対照: そもそも1回目で登録されていなければ、この検査は何も見ていない
  assert.equal(afterFirst.dom, 2, 'contextmenu と click の2本が登録されていない');
  assert.equal(afterFirst.runtime, 1);
});

// vm の中で作られたオブジェクトはプロトタイプが別なので、deepEqual では比べない。
// 値そのものを1つずつ見る。

test('ポストの中を右クリックすると、正規化されたURLを返す', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/123?s=20') });
  assert.equal(h.ask({ type: 'getContextTarget' }).url, 'https://x.com/alice/status/123');
});

test('派生ページのパーマリンクでもポスト本体へ戻す', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/123/photo/1') });
  assert.equal(h.ask({ type: 'getContextTarget' }).url, 'https://x.com/alice/status/123');
});

test('一度渡したURLは捨てられ、二度目は返さない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/123') });
  assert.equal(h.ask({ type: 'getContextTarget' }).url, 'https://x.com/alice/status/123');
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
});

test('ポストの外を右クリックしたときは URL を返さず、画面に知らせる', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.strayElement() });
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
  const toast = h.created.find((el) => el.tagName === 'DIV');
  assert.ok(toast, '通知の帯が作られていない');
  assert.equal(toast.textContent, 'msg:errorNoPostFound');
});

test('通知の帯に読み上げ用の属性が付いている', () => {
  const h = harness();
  h.load();
  h.ask({ type: 'notify', text: 'こんにちは' });
  const toast = h.created.find((el) => el.tagName === 'DIV');
  assert.ok(toast, '通知の帯が作られていない');
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(toast.getAttribute('aria-live'), 'polite');
  assert.equal(toast.getAttribute('aria-atomic'), 'true');
  assert.equal(toast.textContent, 'こんにちは');
  // フォーカスを奪う要素にしない（押せる帯にしない）
  assert.equal(toast.getAttribute('tabindex'), null);
  assert.equal(toast.style.pointerEvents, 'none');
});

test('Shift+Alt クリックはポストのURLを background へ渡し、本来の遷移を止める', () => {
  const h = harness();
  h.load();
  let prevented = false;
  h.fire('click', {
    shiftKey: true,
    altKey: true,
    target: h.postElement('/alice/status/123'),
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'open');
  assert.equal(h.sent[0].url, 'https://x.com/alice/status/123');
  assert.equal(prevented, true);
});

test('ポストの外での Shift+Alt クリックは、何も送らず遷移も止めない', () => {
  const h = harness();
  h.load();
  let prevented = false;
  h.fire('click', {
    shiftKey: true,
    altKey: true,
    target: h.strayElement(),
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.deepEqual(h.sent, []);
  assert.equal(prevented, false, 'ポスト以外のクリックを飲み込んでいる');
});

// ---- 依存が入らなかったときに立ち直れるか（印を立てる順序） ----

test('post-url.js が入らなかった回は、印を残さず listener も登録しない', () => {
  const h = harness();
  h.loadContent(); // 依存なしで content.js だけ実行
  assert.equal(h.domListeners.length, 0, 'listener を登録してしまった');
  assert.equal(h.runtimeListeners.length, 0, 'listener を登録してしまった');
  assert.equal(h.sandbox.__postCloakLoaded, undefined, '読み込み済みの印だけが残った');
});

test('あとから post-url.js を入れて入れ直せば、正常に初期化できる', () => {
  const h = harness();
  h.loadContent(); // 依存なしで失敗する回
  h.loadParser(); // 依存を入れる
  h.loadContent(); // 入れ直し
  assert.equal(h.domListeners.length, 2, '立ち直れていない');
  assert.equal(h.runtimeListeners.length, 1, '立ち直れていない');
  assert.equal(h.sandbox.__postCloakLoaded, '9.9.9');
  // そのうえで、もう一度読んでも二重登録しない
  h.loadContent();
  assert.equal(h.domListeners.length, 2);
  assert.equal(h.runtimeListeners.length, 1);
});

// ---- リンクの上での Shift+Alt クリック（文書の記述と一致させる） ----

function shiftAltClick(h, target) {
  let prevented = false;
  h.fire('click', {
    shiftKey: true,
    altKey: true,
    target,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  return prevented;
}

test('Shift+Alt クリックがポストのリンクの上なら、そのポストを開く', () => {
  const h = harness();
  h.load();
  const prevented = shiftAltClick(h, h.linkElement('/alice/status/123'));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'open');
  assert.equal(h.sent[0].url, 'https://x.com/alice/status/123');
  assert.equal(prevented, true, '本来の遷移を止めていない');
});

test('ポストの画像など派生リンクの上でも、ポスト本体を開く', () => {
  const h = harness();
  h.load();
  shiftAltClick(h, h.linkElement('/alice/status/123/photo/1'));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, 'https://x.com/alice/status/123');
});

test('Shift+Alt クリックがポストでないリンクの上なら、何もせず遷移も止めない', () => {
  const h = harness();
  h.load();
  let anyPrevented = false;
  for (const href of ['/alice', '/hashtag/Space', 'https://example.com/article', '/i/lists/1']) {
    if (shiftAltClick(h, h.linkElement(href))) anyPrevented = true;
  }
  assert.deepEqual(h.sent, [], 'ポストでないリンクで background へ送った');
  assert.equal(anyPrevented, false, '本来の遷移を奪っている');
});

test('ポストの外での Shift+Alt クリックは、案内の帯も出さない', () => {
  // 右クリックのメニュー経路では帯を出すが、Shift+Alt では出さない。
  // 文書がこの2つを混ぜて書いていたので、違いをテストで固定する。
  const h = harness();
  h.load();
  shiftAltClick(h, h.strayElement());
  assert.equal(h.created.length, 0, '通知の帯を作ってしまった');
  assert.deepEqual(h.sent, []);
});

test('修飾キーが揃っていないクリックには反応しない', () => {
  const h = harness();
  h.load();
  for (const mods of [{ shiftKey: true, altKey: false }, { shiftKey: false, altKey: true }]) {
    h.fire('click', {
      ...mods,
      target: h.postElement('/alice/status/123'),
      preventDefault() {
        assert.fail('反応してはいけない');
      },
      stopPropagation() {},
    });
  }
  assert.deepEqual(h.sent, []);
});
