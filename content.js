// PostCloak – content.js
// 右クリックまたは Shift+Alt クリックした場所から「そのポストのURL」を割り出し、
// background へ渡す。ページの DOM は書き換えない（読み取りと、失敗時の通知だけ）。
//
// 全体を無名関数で包む。background から入れ直されたときに、
// 宣言済みの識別子と衝突して丸ごと落ちるのを防ぐため。
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  // 同じ版が既にこのページで動いているなら何もしない（二重登録の防止）。
  if (window.__postCloakLoaded === VERSION) return;

  // URL の判定は post-url.js が持っている。manifest の content_scripts でも、
  // background の入れ直しでも、必ず post-url.js → content.js の順に読む。
  // 読めていないときに黙って死ぬと、原因の分からない無反応になるので出しておく。
  //
  // この確認は「読み込み済み」の印より先に置く。順序が逆だと、post-url.js だけ
  // 入らなかった回に「この版は読み込み済み」だけが残り、あとから post-url.js を
  // 入れて入れ直しても先頭で return して、二度と初期化できなくなる。
  if (typeof PostCloakUrl === 'undefined') {
    console.error('[PostCloak] post-url.js が読み込まれていません');
    return;
  }

  window.__postCloakLoaded = VERSION;

  /* ---------- 0. 定数 ---------- */

  // 右クリックの直後にメニューが押される前提の仕組みなので、古い値は使わない。
  const CONTEXT_TTL_MS = 60_000;

  // 右クリック直前に割り出したURL。
  // メニューのクリックは background 側で起きるので、そこから問い合わせを受けて返す。
  // content script はページが開いている限り生き続けるため、
  // service worker のように途中で捨てられる心配がない。
  let lastContext = null; // { url, at, generation }
  let lastContextTimer = null;
  let contextGeneration = 0;

  // 参照そのものを消す。
  //
  // 問い合わせ時に経過時間を見るだけだと、60秒を過ぎた値は「使えない」が
  // 「消えていない」——次の操作が来るまで古い URL がメモリに残り続ける。
  // 文書に「60秒で捨てる」と書く以上、実際に捨てるようにする。
  function clearLastContext() {
    lastContext = null;
    if (lastContextTimer !== null) {
      clearTimeout(lastContextTimer);
      lastContextTimer = null;
    }
  }

  // 世代番号を見るのは、続けて右クリックしたときに、
  // 古いほうの timer が新しい context を消してしまわないようにするため。
  function setLastContext(url) {
    clearLastContext();
    if (!url) return;

    const generation = ++contextGeneration;
    lastContext = { url, at: Date.now(), generation };

    // 自分の handle だけを片づける。
    //
    // 無条件に lastContextTimer = null とすると、停止中のタブなどで古い timer が
    // 遅れて動いたときに、そのとき動いている新しい timer の handle まで消えてしまう。
    // handle を失った timer は clearLastContext() で解除できなくなり、
    // 値を渡したあとも 60 秒後の callback だけが残る。
    const timerId = setTimeout(() => {
      if (lastContext && lastContext.generation === generation) {
        lastContext = null;
      }
      if (lastContextTimer === timerId) {
        lastContextTimer = null;
      }
    }, CONTEXT_TTL_MS);

    lastContextTimer = timerId;
  }

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
        const url = postUrl(el.getAttribute('href'));
        if (url) return url;
        if (stopAtLink) return null;
      }
      if (el.tagName === 'ARTICLE') {
        return postUrl(permalinkHref(el));
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

  // ページ内の href は相対形（/alice/status/123）で書かれているので、
  // このページのURLを基準として渡す。判定そのものは post-url.js が持つ。
  function postUrl(href) {
    return PostCloakUrl.toPostUrl(href, location.href);
  }

  /* ---------- 2. 右クリック ---------- */

  // capture 段で拾い、bubble 段での伝播停止の影響を受けにくくする。
  // ただし、より先に登録された window / document の capture listener による
  // 伝播停止まで防げるわけではない。
  // preventDefault はしない（Chrome 標準のメニューはそのまま出す）。
  document.addEventListener(
    'contextmenu',
    (e) => {
      // ページ側の script が作った合成イベントは受け取らない。
      // 共有された DOM の上では、ページ側が contextmenu を自分で dispatch できる。
      // それを利用者の操作として扱うと、望まないシークレットウィンドウが開いたり、
      // 直前の右クリック対象を横から書き換えられたりする。
      if (!e.isTrusted) return;

      // 右クリックは打ち切らない（メニューの文言どおりポストを返す）
      setLastContext(resolveStatusUrl(e.target, false));
    },
    true
  );

  /* ---------- 3. Shift+Alt クリック ---------- */

  document.addEventListener(
    'click',
    (e) => {
      // 合成イベントは受け取らない（上の contextmenu と同じ理由）
      if (!e.isTrusted) return;
      // Ctrl / Command が一緒に押されているときは対象外。
      // Windows の多くのキーボード配列（US-International など）では AltGr が
      // Ctrl+Alt として届くので、これを除かないと AltGr で記号を打ちながら
      // クリックしただけで反応してしまう。文書どおり「Shift+Alt だけ」にする。
      //
      // AltGr が Ctrl+Alt として届かない配列・環境もあるので、修飾キーの状態を
      // 直接も見る。getModifierState は古い環境に無いことがあるため存在確認つき。
      const altGraph =
        typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
      if (e.ctrlKey || e.metaKey || altGraph) return;
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
      // timer も一緒に解除する。
      clearLastContext();
      // timer は停止中のタブなどで遅れて動くことがあるので、時刻の判定も残す。
      // どちらか一方ではなく、両方で 60 秒を超えた値を返さないようにする。
      const fresh = ctx && Date.now() - ctx.at < CONTEXT_TTL_MS;
      if (!fresh) notify(chrome.i18n.getMessage('errorNoPostFound'));
      sendResponse({ url: fresh ? ctx.url : null });
      return false;
    }
    // 右クリックした先が、それ自体ポストのURLだった場合、background は
    // このタブへ問い合わせずに開ける。その経路だと、直前の contextmenu で
    // 保存した値だけが残ってしまうので、開く前に消してもらう。
    // 画面には何も出さない（利用者から見れば操作は成功している）。
    if (msg && msg.type === 'clearContextTarget') {
      // 消す対象を指定しない消去は受け付けない。
      // 消去の依頼は非同期に届くので、遅れて着いた古い依頼が、その後に
      // 控えた別のポストを消してしまう。判定は「いま控えている値と、
      // 開こうとしている値が同じか」で行う。
      const expected = PostCloakUrl.toPostUrl(msg.expectedUrl, location.href);
      if (!expected) {
        sendResponse({ cleared: false, reason: 'invalid' });
      } else if (!lastContext) {
        sendResponse({ cleared: false, reason: 'empty' });
      } else if (lastContext.url !== expected) {
        sendResponse({ cleared: false, reason: 'mismatch' });
      } else {
        clearLastContext();
        sendResponse({ cleared: true });
      }
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
    console.error('[PostCloak] background へ渡せませんでした:', e);
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
      // 読み上げ環境へも同じ内容を届ける。role="status" は割り込まずに読ませる指定で、
      // フォーカスは動かない（この帯は操作対象ではなく、押せる要素も持たない）。
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      toastEl.setAttribute('aria-atomic', 'true');
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
        // Windows では Segoe UI、日本語が入る場合は Yu Gothic UI / Meiryo へ落とす。
        // ページ側の font-family を継承しないよう、ここで明示する。
        font: '14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", Meiryo, Roboto, Arial, sans-serif',
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
