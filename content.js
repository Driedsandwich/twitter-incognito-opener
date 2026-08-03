// Twitter Incognito Opener – content.js
// 右クリックまたは Shift+Alt クリックした場所から「そのポストのURL」を割り出し、
// background へ渡す。ページの DOM は書き換えない（読み取りと、失敗時の通知だけ）。
//
// 全体を無名関数で包む。background から入れ直されたときに、
// 宣言済みの識別子と衝突して丸ごと落ちるのを防ぐため。
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  // 同じ版が既にこのページで動いているなら何もしない（二重登録の防止）。
  if (window.__tioLoaded === VERSION) return;
  window.__tioLoaded = VERSION;

  /* ---------- 0. 定数 ---------- */

  // 解決したURLの行き先が、必ずここに載っているホストであることを確かめる。
  // href が絶対URLだったときに、まったく別のサイトをシークレットで開かないため。
  const ALLOWED_HOST = /^(www\.)?(x|twitter)\.com$/i;

  // 右クリックの直後にメニューが押される前提の仕組みなので、古い値は使わない。
  const CONTEXT_TTL_MS = 60_000;

  // 右クリック直前に割り出したURL。
  // メニューのクリックは background 側で起きるので、そこから問い合わせを受けて返す。
  // content script はページが開いている限り生き続けるため、
  // service worker のように途中で捨てられる心配がない。
  let lastContext = null; // { url, at }

  /* ---------- 1. URL の割り出し ---------- */

  // 起点の要素から祖先をたどって、その要素が属するポストのURLを返す。見つからなければ null。
  //
  //   1. 途中の <a> が /status/ のリンクならそれを採る（タイムスタンプ、引用元の画像など）
  //   2. <article> に当たったら、その中のパーマリンクを採る
  //   3. どちらにも当たらずに文書の根まで来たら null（ポストの外だった）
  //
  // stopAtLink は、/status/ 以外のリンク（プロフィール、外部記事、ハッシュタグ）に
  // 当たったところで打ち切るかどうか。経路によって正解が違う。
  //
  //   Shift+Alt クリック  … 打ち切る。クリックは本来そのリンクへ遷移する操作なので、
  //                          それを奪ったうえで別のもの（囲みのポスト）を開かない
  //   右クリックメニュー  … 打ち切らない。利用者はメニューの
  //                          「このポストをシークレットウィンドウで開く」を選んでおり、
  //                          本来の遷移を奪ってもいない。文言どおりポストを返す
  function resolveStatusUrl(start, stopAtLink) {
    let el = start && start.nodeType === Node.TEXT_NODE ? start.parentElement : start;

    while (el && el !== document.documentElement) {
      if (el.tagName === 'A') {
        const url = toPostUrl(el.getAttribute('href'));
        if (url) return url;
        if (stopAtLink) return null;
      }
      if (el.tagName === 'ARTICLE') {
        return toPostUrl(permalinkHref(el));
      }
      el = el.parentElement;
    }
    return null;
  }

  // article の中からパーマリンクの href を取り出す。
  // 「最初の /status/ リンク」ではなく <time> を包むリンクを先に見る。
  // 実測（2026-08-03・ログイン状態の x.com・52件）では両者は一致したが、
  // 画面によっては /analytics や引用元のリンクが文書順で先に来ることがある。
  function permalinkHref(article) {
    const timed = article.querySelector('a[href*="/status/"] time');
    const a = (timed && timed.closest('a')) || article.querySelector('a[href*="/status/"]');
    return a ? a.getAttribute('href') : null;
  }

  // href を絶対URLにし、x.com / twitter.com のポストURLであれば返す。それ以外は null。
  function toPostUrl(href) {
    if (!href || !href.includes('/status/')) return null;
    let url;
    try {
      // 旧実装は location.origin + href を素で連結していたため、href が絶対URLだと
      // "https://x.comhttps://x.com/…" という壊れたURLを作っていた。
      url = new URL(href, location.href);
    } catch (e) {
      return null;
    }
    // http:// を弾く。x.com は https のみで、混在した絶対URLを掴む理由がない。
    if (url.protocol !== 'https:') return null;
    if (!ALLOWED_HOST.test(url.hostname)) return null;
    // /photo/1 /analytics /likes などの派生リンクは、ポスト本体に戻してから開く。
    // これらは 301 せず 200 を返すので、そのまま開くと目的の画面に着かない。
    url.pathname = url.pathname.replace(
      /\/(photo|video|analytics|likes|retweets|quotes)(\/\d+)?\/?$/,
      ''
    );
    // ポストのURLは必ず /status/<数字> の形をしている。
    // これを見ないと、"/status/" を含むだけの壊れた href が相対パスとして解釈され、
    // x.com の存在しないページを開いてしまう。
    if (!/\/status\/\d+/.test(url.pathname)) return null;
    url.hash = '';
    return url.href;
  }

  /* ---------- 2. 右クリック ---------- */

  // capture 段で拾う。ページ側が contextmenu を止めても、こちらへ先に届く。
  // preventDefault はしない（Chrome 標準のメニューはそのまま出す）。
  document.addEventListener(
    'contextmenu',
    (e) => {
      // 右クリックは打ち切らない（メニューの文言どおりポストを返す）
      const url = resolveStatusUrl(e.target, false);
      lastContext = url ? { url, at: Date.now() } : null;
    },
    true
  );

  /* ---------- 3. Shift+Alt クリック ---------- */

  document.addEventListener(
    'click',
    (e) => {
      if (!e.shiftKey || !e.altKey) return;

      // Shift+Alt は本来の遷移を奪うので、/status/ 以外のリンク上では打ち切る
      const url = resolveStatusUrl(e.target, true);
      // 見つからないときは preventDefault しない。
      // ポスト以外の場所での Shift+Alt クリックを、拡張が黙って飲み込まないため。
      if (!url) return;

      // X の行クリックによる遷移は、click が既に defaultPrevented なら走らない。
      // stopPropagation は X 側の実装が変わったときの保険。
      e.preventDefault();
      e.stopPropagation();
      send({ type: 'open', url });
    },
    true
  );

  /* ---------- 4. background とのやりとり ---------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'getContextTarget') {
      const ctx = lastContext;
      // 一度渡した値は捨てる。取っておくと、次に右クリックが届かなかったときに
      // 前のポストを開いてしまう（旧実装のいちばん困る挙動と同じ症状になる）。
      lastContext = null;
      const fresh = ctx && Date.now() - ctx.at < CONTEXT_TTL_MS;
      if (!fresh) notify(chrome.i18n.getMessage('errorNoPostFound'));
      sendResponse({ url: fresh ? ctx.url : null });
      return false;
    }
    if (msg && msg.type === 'notify') {
      notify(msg.text || chrome.i18n.getMessage('errorNoPostFound'));
      return false;
    }
    return false;
  });

  // 拡張を更新・無効化した直後はこのタブの content script が孤立していることがある。
  // そのときの sendMessage は例外になるので、握り潰さず画面に出す。
  function send(payload) {
    try {
      const p = chrome.runtime.sendMessage(payload);
      if (p && typeof p.catch === 'function') p.catch(onSendError);
    } catch (e) {
      onSendError(e);
    }
  }

  function onSendError(e) {
    console.error('[tio] background へ渡せませんでした:', e);
    notify(chrome.i18n.getMessage('errorDisconnected'));
  }

  /* ---------- 5. 画面への通知 ---------- */

  // alert() は操作を止めてしまううえ、どこから出たのかも伝わらないので使わない。
  // 数秒で消える小さな帯を出す。スタイルは要素へ直接当てる
  // （ページ側の CSS とも Content-Security-Policy とも干渉しないため）。
  let toastEl = null;
  let toastTimer = null;

  function notify(text) {
    if (!text || !document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        maxWidth: 'min(90vw, 420px)',
        padding: '10px 16px',
        borderRadius: '9999px',
        background: 'rgba(15,20,25,.92)',
        color: '#fff',
        font: '14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'center',
        // 他の拡張が最大値を使うことがあるので、こちらも最大値に揃える。
        zIndex: '2147483647',
        pointerEvents: 'none',
        boxShadow: '0 2px 12px rgba(0,0,0,.35)',
      });
    }
    toastEl.textContent = text;
    if (!toastEl.isConnected) document.body.appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.remove(), 4000);
  }
})();
