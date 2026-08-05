// PostCloak – post-url.js
// 「この href はポストのURLか」を判定し、開いてよい形へ正規化する。
// background（service worker）と content script の両方がこのファイルを読む。
//
// 同じ判定を2つのファイルに置くと、片方だけ直して食い違う。実際に旧版では
// content 側だけが相対URLを扱えるようになっていて、2つの実装が既にずれていた。
//
// トップレベルで const / let / class を使わない。content script は、既に開いていた
// タブへ入れ直すことがあり、そのとき同じファイルがもう一度実行される。
// const で宣言すると、その再実行が「識別子の再宣言」で丸ごと落ちる。
var PostCloakUrl = (function () {
  'use strict';

  // ホストは完全一致で持つ。正規表現にすると、書き間違い一つで
  // x.com.evil.example のような形を通す余地が残る。
  var ALLOWED_HOSTS = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'];

  // 開いてよい「ポスト本体」の形。ここに無い形は、知らない形として弾く。
  // /i/status/ と /i/web/status/ はどちらも実在する（2026-08-05 実測: 両方とも
  // 307 で https://x.com/<handle>/status/<id> へ転送された。転送されないことの
  // 対照として /i/zzzz/status/20 を同じ手順に通し、こちらは 200 のままだった）。
  var BASE_PATHS = [
    /^\/[A-Za-z0-9_]+\/status\/\d+$/,
    /^\/i\/web\/status\/\d+$/,
    /^\/i\/status\/\d+$/,
  ];

  // ポスト本体にぶら下がる派生ページ。許す形を1つずつ書き出し、これ以外の
  // 追加セグメントは弾く。派生ページは 301 せず 200 を返すので、
  // そのまま開くと目的の画面に着かない。だから本体へ戻してから開く。
  var DERIVED_TAIL = /(?:\/(?:photo|video)\/\d+|\/(?:analytics|likes|retweets|quotes))\/?$/;

  // href をポストのURLへ正規化する。ポストでなければ null。
  //
  // base を渡したときだけ相対URLを解釈する。background は Chrome から絶対URLしか
  // 受け取らないので base を渡さない＝相対URLはそこで弾かれる。
  function toPostUrl(href, base) {
    if (typeof href !== 'string' || href === '') return null;

    var url;
    try {
      url = base ? new URL(href, base) : new URL(href);
    } catch (e) {
      return null;
    }

    // x.com は https のみ。混在した絶対URLを掴む理由がない。
    if (url.protocol !== 'https:') return null;
    // URL に埋め込まれた資格情報（https://user:pass@host/…）はそのまま開かない。
    if (url.username !== '' || url.password !== '') return null;
    // 非標準ポートは x.com に存在しない。
    if (url.port !== '') return null;
    if (ALLOWED_HOSTS.indexOf(url.hostname) === -1) return null;

    // 派生ページは1段だけ剥がす。/photo/1/evil のように後ろが続く形は
    // ここで剥がれず、下の完全一致に落ちて弾かれる。
    var path = url.pathname.replace(DERIVED_TAIL, '');
    // 末尾のスラッシュだけは許す（/alice/status/123/ は同じポスト）。
    if (path.length > 1) path = path.replace(/\/$/, '');

    for (var i = 0; i < BASE_PATHS.length; i++) {
      if (BASE_PATHS[i].test(path)) {
        // 組み立て直すので、クエリとフラグメントは構造上まぎれ込まない。
        return 'https://' + url.hostname + path;
      }
    }
    return null;
  }

  return { toPostUrl: toPostUrl, ALLOWED_HOSTS: ALLOWED_HOSTS };
})();

// Node のテストから読むためだけの行。content script と service worker には module が無い。
if (typeof module !== 'undefined' && module.exports) module.exports = PostCloakUrl;
