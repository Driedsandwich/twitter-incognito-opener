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

  // 時計と timer は本物を使わない。60秒の消去を、待たずに確かめるため。
  let clock = 1_000_000;
  const timers = new Map();
  let nextTimerId = 1;

  const sandbox = {
    document,
    chrome,
    console,
    location: { href: 'https://x.com/home' },
    Node: { TEXT_NODE: 3 },
    URL,
    Date: { now: () => clock },
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
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
    // 実ブラウザのイベントは isTrusted が true。既定でそれに合わせ、
    // 合成イベントのテストだけ明示的に false を渡す。
    // event に渡した値はそのまま載るので、getModifierState のような関数も
    // 場面ごとに差し替えられる（AltGr の判定を撃つため）。
    fire(type, event) {
      const e = { isTrusted: true, ...event };
      for (const l of domListeners) if (l.type === type) l.fn(e);
    },
    // 時計を進める（timer は自動では動かない）
    advance(ms) {
      clock += ms;
    },
    // 仕掛かっている timer を動かす。ms を渡すとその遅延のものだけを動かす。
    // 通知の帯（4000ms）と context の消去（60000ms）を撃ち分けるため。
    fireTimers(ms) {
      const target = [...timers.entries()].filter(([, t]) => ms === undefined || t.ms === ms);
      for (const [id, t] of target) {
        timers.delete(id);
        t.fn();
      }
      return target.length;
    },
    pendingTimers(ms) {
      return [...timers.values()].filter((t) => ms === undefined || t.ms === ms).length;
    },
    // 仕掛かっている timer の中身を取り出す（解除されたあとに遅れて動く場面を作るため）
    captureTimer(ms) {
      const found = [...timers.values()].find((t) => t.ms === ms);
      return found ? found.fn : null;
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

// ---- 60秒で参照そのものが消えるか ----

const TTL = 60_000;

test('60秒未満なら1回だけ返し、二度目は返さない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/123') });
  h.advance(TTL - 1);
  assert.equal(h.ask({ type: 'getContextTarget' }).url, 'https://x.com/alice/status/123');
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
});

test('時計が60秒を超えていれば返さない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/123') });
  h.advance(TTL + 1);
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
});

test('timer が動けば、時計が60秒未満でも参照は消えている', () => {
  // 「経過時間の判定」ではなく「timer が実際に消したこと」を見る。
  // 時計を進めないので、判定だけの実装ならここで URL が返ってしまう。
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/123') });
  assert.equal(h.pendingTimers(TTL), 1, '消去用の timer が仕掛かっていない');
  assert.equal(h.fireTimers(TTL), 1);
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null, 'timer が参照を消していない');
});

test('古い timer が、あとから保存した context を消さない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  const staleTimer = h.captureTimer(TTL); // A の timer を控える
  h.fire('contextmenu', { target: h.postElement('/bob/status/2') }); // B で上書き
  staleTimer(); // 解除済みの A の timer が遅れて動いたとみなす
  assert.equal(
    h.ask({ type: 'getContextTarget' }).url,
    'https://x.com/bob/status/2',
    '古い timer が新しい context を消した'
  );
  // 値だけでなく handle も見る。古い callback が B の handle まで null にしていると、
  // B を渡したあとの解除が空振りして、60秒後の callback だけが残る。
  assert.equal(h.pendingTimers(TTL), 0, '古い timer が B の handle を失わせた');
});

test('新しい context の timer は、その context を消す', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  h.fire('contextmenu', { target: h.postElement('/bob/status/2') });
  assert.equal(h.pendingTimers(TTL), 1, '古い timer が解除されていない');
  h.fireTimers(TTL);
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
});

test('ポストの外を右クリックすると、前の context も timer も消える', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  h.fire('contextmenu', { target: h.strayElement() });
  assert.equal(h.pendingTimers(TTL), 0, 'timer が残っている');
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
});

test('clearContextTarget で、控えている値も timer も消える', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  assert.equal(h.pendingTimers(TTL), 1, '対照: timer が仕掛かっていない');

  h.ask({ type: 'clearContextTarget' });

  assert.equal(h.ask({ type: 'getContextTarget' }).url, null, '値が残っている');
  assert.equal(h.pendingTimers(TTL), 0, 'timer が残っている');
});

test('clearContextTarget は、画面へ何も出さない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  h.ask({ type: 'clearContextTarget' });
  assert.equal(h.created.length, 0, '通知の帯を作ってしまった');
});

test('clearContextTarget は、値が無くても二度送っても例外にならない', () => {
  const h = harness();
  h.load();
  h.ask({ type: 'clearContextTarget' });
  h.ask({ type: 'clearContextTarget' });
  assert.equal(h.pendingTimers(TTL), 0);
});

test('一度渡したら timer も解除される', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  h.ask({ type: 'getContextTarget' });
  assert.equal(h.pendingTimers(TTL), 0, '渡したあとに timer が残っている');
});

// ---- ページ側が作った合成イベントを受け取らない ----

test('合成の contextmenu は、context を作らず既存も上書きしない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { target: h.postElement('/alice/status/1') });
  // ページ側 script が作ったイベントのつもり
  h.fire('contextmenu', { isTrusted: false, target: h.postElement('/evil/status/999') });
  assert.equal(
    h.ask({ type: 'getContextTarget' }).url,
    'https://x.com/alice/status/1',
    '合成イベントに上書きされた'
  );
});

test('合成の contextmenu 単独では、context を作らない', () => {
  const h = harness();
  h.load();
  h.fire('contextmenu', { isTrusted: false, target: h.postElement('/evil/status/999') });
  assert.equal(h.pendingTimers(TTL), 0);
  assert.equal(h.ask({ type: 'getContextTarget' }).url, null);
});

test('合成の Shift+Alt クリックは、何も送らず遷移も止めない', () => {
  const h = harness();
  h.load();
  let prevented = false;
  h.fire('click', {
    isTrusted: false,
    shiftKey: true,
    altKey: true,
    target: h.postElement('/alice/status/123'),
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.deepEqual(h.sent, [], '合成イベントで background へ送った');
  assert.equal(prevented, false, '合成イベントで本来の遷移を止めた');
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

test('Ctrl や Command が一緒に押されていたら反応しない（Windows の AltGr 対策）', () => {
  // Windows の多くの配列では AltGr が Ctrl+Alt として届く。
  // これを除かないと、AltGr で記号を打ちながらクリックしただけで反応してしまう。
  const h = harness();
  h.load();
  let prevented = false;
  for (const mods of [
    { shiftKey: true, altKey: true, ctrlKey: true }, // Shift+AltGr 相当
    { shiftKey: true, altKey: true, metaKey: true }, // macOS の Cmd 併用
  ]) {
    h.fire('click', {
      ...mods,
      target: h.postElement('/alice/status/123'),
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
    });
  }
  assert.deepEqual(h.sent, [], 'AltGr / Command 併用で反応した');
  assert.equal(prevented, false, '本来の動作を止めてしまった');
});

test('AltGraph が押されていたら、Ctrl も Command も無くても反応しない', () => {
  // AltGr が Ctrl+Alt として届かない配列・環境がある。
  // そこでは ctrlKey / metaKey がどちらも false のまま Shift+AltGr が届くので、
  // 修飾キーの状態を直接見ないと素通りする。
  const h = harness();
  h.load();
  let prevented = false;
  let stopped = false;
  h.fire('click', {
    shiftKey: true,
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    getModifierState: (key) => key === 'AltGraph',
    target: h.postElement('/alice/status/123'),
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  assert.deepEqual(h.sent, [], 'AltGr 単独で反応した');
  assert.equal(prevented, false, '本来の動作を止めてしまった');
  assert.equal(stopped, false, '伝播を止めてしまった');
});

test('AltGraph 以外の修飾キーが押されていても、Shift+Alt クリックは通る', () => {
  // 上の除外が「getModifierState があれば止める」になっていないことを見る。
  // 問い合わせる key が 'AltGraph' でなければ、この場面で反応が消える。
  const h = harness();
  h.load();
  const asked = [];
  h.fire('click', {
    shiftKey: true,
    altKey: true,
    getModifierState: (key) => {
      asked.push(key);
      return key === 'CapsLock';
    },
    target: h.postElement('/alice/status/123'),
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(h.sent.length, 1, 'AltGraph 以外で反応が消えた');
  assert.equal(h.sent[0].type, 'open');
  assert.equal(h.sent[0].url, 'https://x.com/alice/status/123');
  assert.deepEqual(asked, ['AltGraph'], "問い合わせた修飾キーが 'AltGraph' ではない");
});

test('getModifierState が無いイベントでも Shift+Alt クリックは通る', () => {
  // 古い環境では getModifierState が無いことがある。
  // 存在確認を外すと、ここで例外になって拡張ごと黙って止まる。
  const h = harness();
  h.load();
  h.fire('click', {
    shiftKey: true,
    altKey: true,
    getModifierState: undefined,
    target: h.postElement('/alice/status/123'),
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(h.sent.length, 1, 'getModifierState が無いと反応しなくなった');
  assert.equal(h.sent[0].url, 'https://x.com/alice/status/123');
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
