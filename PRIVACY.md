# プライバシーポリシー / Privacy Policy — PostCloak

最終更新: 2026-08-05

---

## 日本語

### 1. 収集・送信するもの

**ありません。** 本拡張は、利用者の情報を収集せず、外部へ送信せず、第三者へ提供しません。**拡張自身が外部のサーバーへ通信することはありません**（解析サービス・広告・外部API・独自サーバーのいずれも使っていません）。

ただし1点だけ、通信そのものが起きないという意味ではありません。利用者がポストを開く操作をすると、**Chrome がそのポストのURLへ通常どおりページを読み込みます**。これは利用者がそのURLを自分でアドレスバーに入れて開いたときと同じ通信で、拡張が別のどこかへ情報を送っているわけではありません。

### 2. 読み取るもの

`x.com` / `www.x.com` / `twitter.com` / `www.twitter.com` のページを開いている間、**右クリックまたは Shift+Alt クリックした場所の周辺の DOM を読み取ります。**

- 読み取るのは、その場所が属するポストのURL（`https://x.com/<利用者名>/status/<番号>`）を1つ取り出すためだけです
- 取り出しはすべて利用者の端末内（ブラウザの中）で完結します
- ポストの本文、画像、閲覧履歴は取り出しません
- **ただし、取り出すURLにはそのポストの投稿者にあたる部分（`/<利用者名>/`）が含まれます。** ポストのURLを1つ取り出す以上、この部分は避けられません。これを別に取り出したり、記録したりはしません
- 読み取った内容を**永続的に**保存しません（一時的な保持については §3）

読み取りの範囲は上記4つのドメインに限られます。他のサイトでは動作せず、右クリックメニューにも項目が出ません（`manifest.json` の `content_scripts.matches` と `contextMenus` の `documentUrlPatterns` が、いずれもこの4つに限定されているため）。

### 3. 保存するもの

**永続的に保存するものはありません。**

直前に割り出したポストのURLを1つだけ、そのタブのメモリ上に一時的に置きます。これは「右クリックした場所」と「メニューを押した瞬間」が別々の処理で起きるためです。この値は次の条件で消えます。

- 一度使ったら、その場で捨てる
- 60秒経過したら失効する
- タブを閉じる、またはページを移動したら消える

ディスクにも `chrome.storage` にも書きません。同期もしません。

### 4. 要求する権限とその理由

| 権限 | 用途 |
|---|---|
| `contextMenus` | 右クリックメニューに項目を1つ追加するため。これ以外に使いません |
| `scripting` | **拡張のインストール・更新より前から開いていたタブに、content script を入れ直すためだけ**に使います。Chrome は既に開いているタブへ遡って content script を入れないため、これが無いとインストール直後の右クリックが何も起きずに終わります。呼ぶのはコード上1箇所（`background.js` の `reviveContentScript`）だけです |
| `host_permissions`（上記4ドメイン） | 上の `scripting` による入れ直しの対象を、この4つに限るため |
| `content_scripts.matches`（上記4ドメイン） | ポストのURLを割り出す処理を、この4つのドメインでだけ動かすため |

`tabs`（閲覧履歴の読み取り）、`storage`、`<all_urls>` は要求していません。

### 5. リモートコードの実行

行いません。配布しているコードがすべてで、外部から取得して実行するコードはありません。`eval()` も、文字列から動的にコードを作って走らせる処理も使っていません。

Manifest V3 のポリシーと既定の Content Security Policy はこれを禁じており、本拡張もそれに沿っています。ただし「Manifest V3 だから何をしても不可能」という意味ではありません。ここで述べているのは、**このリポジトリで配布しているコードに、その種の処理が無い**ということです。

### 6. 第三者への提供

行いません。共有する相手が存在しません。

### 7. 変更があった場合

本ポリシーを変更する場合は、このファイルを更新し、リポジトリの更新履歴に残します。データの取り扱いを変える変更を行う場合は、拡張の更新より前に記載します。

### 8. 連絡先

GitHub リポジトリの Issue でお願いします。

---

## English

### 1. What we collect or transmit

**Nothing.** This extension does not collect, transmit, or share any user information. **The extension itself makes no network requests to any server** (no analytics, no ads, no external APIs, no server of our own).

One clarification: that does not mean no traffic occurs at all. When you ask the extension to open a post, **Chrome loads that post's URL as a normal page navigation.** That is the same request you would make by typing the URL yourself; the extension is not sending anything anywhere else.

### 2. What we read

While a page on `x.com`, `www.x.com`, `twitter.com`, or `www.twitter.com` is open, the extension **reads the DOM around the point you right-clicked or Shift+Alt clicked.**

- The sole purpose is to extract one post URL (`https://x.com/<user>/status/<id>`) for the post that point belongs to.
- Extraction happens locally, inside the user's browser.
- Post text, images, and browsing history are not extracted.
- **The URL does, however, contain a path segment identifying the post's author (`/<user>/`).** Extracting one post URL necessarily includes it. It is not extracted separately or recorded.
- Nothing that is read is stored **persistently** (see §3 for the temporary hold).

Reading is limited to the four domains above. The extension does not run on any other site, and its context menu item does not appear there.

### 3. What we store

**Nothing persistent.**

One post URL — the one most recently resolved — is held in that tab's memory, because the right-click and the menu selection are two separate events. It is discarded when any of the following happens:

- it is used once (discarded immediately on read);
- 60 seconds elapse;
- the tab is closed or navigates away.

Nothing is written to disk or to `chrome.storage`, and nothing is synced.

### 4. Permissions and why

| Permission | Purpose |
|---|---|
| `contextMenus` | To add one item to the right-click menu. Nothing else |
| `scripting` | **Only** to re-inject the content script into tabs that were already open before the extension was installed or updated. Chrome does not retroactively inject content scripts, so without this the first right-click after installing does nothing. Called from exactly one place in the code (`reviveContentScript` in `background.js`) |
| `host_permissions` (the four domains) | To limit the re-injection above to those four domains |
| `content_scripts.matches` (the four domains) | To run the URL resolution only on those four domains |

No `tabs` (read your browsing history), no `storage`, no `<all_urls>`.

### 5. Remote code

None. All code ships inside the extension; nothing is fetched and executed from elsewhere. There is no `eval()` and no code built dynamically from strings.

Manifest V3's policy and its default Content Security Policy forbid this, and the extension complies. That is not a claim that Manifest V3 makes every such thing impossible — the statement here is that **the code distributed in this repository contains none of it.**

### 6. Sharing with third parties

None. There is no recipient.

### 7. Changes to this policy

Changes will be made in this file and recorded in the repository history. Any change to data handling will be documented before the corresponding extension update is published.

### 8. Contact

Please open an issue on the GitHub repository.

---

PostCloak is not affiliated with, endorsed by, or sponsored by X Corp. X and Twitter are trademarks of X Corp.

本拡張は X Corp. とは無関係で、同社による承認・後援を受けていません。X および Twitter は X Corp. の商標です。
