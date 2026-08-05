# ストア掲載情報の正本

Chrome ウェブストアの掲載ページに載せている文面と設定を、リポジトリ側にも置いたものです。
**ストアの掲載内容とこのファイルが食い違ったら、こちらを直してから掲載を直します。**

掲載ページ: https://chromewebstore.google.com/detail/pekgcaiokjokphdlmnkldmclffkeepnh

> ウェブストアのダッシュボードは、ブラウザ拡張から操作できません（Chrome 側が
> `The extensions gallery cannot be scripted.` で拒否します）。掲載内容の反映は
> かならず手作業になります。

---

## 1. 説明（詳細）— 日本語

```
Chrome の「シークレット ウィンドウで開く」は、リンクの右クリックメニューの項目です。
カーソルの下に <a> 要素があるときにしか出ません。

x.com のタイムラインでは、ポスト本文は <a> ではなく <div> にクリック処理が付いている
だけです。だからポスト本文を右クリックしても、その選択肢は出てきません。

PostCloak は、そのリンクになっていない場所からポストのURLを割り出して開きます。

■ 使い方
・ポストのどこかを Shift+Alt クリックする
・またはポストのどこかを右クリックして「このポストをシークレットウィンドウで開く」を選ぶ

どちらも同じ結果になります。
ポストの外（サイドバーや余白）を右クリックして選んだときは、ウィンドウは開かず、
画面下に短い案内が出ます。Shift+Alt クリックのときは何も起きません。

■ 動作する範囲
x.com / www.x.com / twitter.com / www.twitter.com のページ上だけです。
第三者のサイトに埋め込まれたポストでは動かず、メニュー項目も出しません。
pro.x.com（X Pro）は画面の作りが別で、対象外です。

■ 知っておいていただきたいこと
・シークレットウィンドウは毎回あたらしく開きます。既にあるシークレットウィンドウに
　タブを足す機能はありません
・シークレットウィンドウは何枚開いても中身を共有し、最後の1枚を閉じるまで
　セッションが残ります
・ポストのURLでないリンク（プロフィール、外部記事、ハッシュタグなど）の上で
　Shift+Alt クリックしたときは、この拡張は何もせず、本来の移動をそのまま通します。
　ポストのパーマリンクや画像のリンクは、そのポストとして扱います

■ プライバシー
右クリックまたは Shift+Alt クリックした場所の周辺の DOM と、そこから取り出した
ポストのURL1件を、端末内で取り扱います。そのポストをシークレットウィンドウで開く
ためだけに使い、端末の外へは出しません。
拡張自身が外部のサーバーへ通信することはありません（解析サービス・広告・外部APIの
いずれも使っていません）。右クリック経路のURLは、そのタブのメモリに最大60秒だけ置き、
使ったら捨てます。永続的な保存はしません。
（ポストを開いたときは、Chrome がそのURLへ通常どおりページを読み込みます）
要求する権限は contextMenus と scripting の2つで、閲覧履歴を読む権限は要求しません。
本拡張によるユーザーデータの利用は、Chrome ウェブストア ユーザーデータ ポリシー
（Limited Use 要件を含む）に準拠します。

■ 免責
本拡張は X Corp. とは無関係の独立したツールで、同社による承認・後援を受けていません。
X および Twitter は X Corp. の商標です。

ソースコードは MIT ライセンスで公開しています。不具合の報告は Issue でお願いします。
```

## 2. 説明（詳細）— 英語

> 掲載ページに英語ロケールを足すときの正本です。**拡張そのものの名前と短い説明（`manifest.json` の `name` / `description`）は、どのロケールでも日本語のままにしています**（`_locales/en/messages.json` の `extName` / `extDescription` を日本語文面に揃えてあります）。`default_locale` が `en` なので、ここを英語にすると公開中の掲載名が変わってしまうためです。メニューや通知など製品内の文言は、通常どおり英語と日本語で分かれます。

```
Chrome's "Open link in Incognito window" is an item in the link context menu.
It only appears when there is an <a> element under the cursor.

On the x.com timeline, the body of a post is not an <a> — it is a <div> with a
click handler. So right-clicking the text of a post never offers that option.

PostCloak works out the post's URL from those non-link areas and opens it.

■ How to use
- Shift+Alt click anywhere on a post
- Or right-click a post and choose "Open this post in an Incognito window"

Both do the same thing.
Outside a post (sidebar, margins): choosing the menu item opens no window and shows a
short notice at the bottom of the page. A Shift+Alt click there does nothing at all.

■ Where it runs
Only on pages of x.com / www.x.com / twitter.com / www.twitter.com.
It does not run on posts embedded in third-party sites, and no menu item appears there.
pro.x.com (X Pro) has a different layout and is out of scope.

■ Things worth knowing
- A new Incognito window opens every time. There is no feature that adds a tab to an
  Incognito window you already have open.
- Incognito windows share one session; it lasts until you close the last one.
- Shift+Alt clicking a link that is not a post URL (a profile, an external article, a
  hashtag) does nothing, and the normal navigation goes through untouched. A post
  permalink or a post image link is treated as that post.

■ Privacy
This extension handles, on your device, the DOM around the point you right-clicked or
Shift+Alt clicked, plus the one post URL extracted from it. That is used solely to open
the post in an Incognito window, and it never leaves your device.
The extension itself makes no network requests to any server (no analytics, no ads, no
external APIs). On the right-click path, the URL is held in that tab's memory for at
most 60 seconds and discarded once used. Nothing is stored persistently.
(When the post opens, Chrome loads that URL as an ordinary page navigation.)
It requests two permissions, contextMenus and scripting, and does not request
permission to read your browsing history.
The use of user data by this extension complies with the Chrome Web Store User Data
Policy, including the Limited Use requirements.

■ Disclaimer
This is an independent, unofficial tool. It is not affiliated with, endorsed by, or
sponsored by X Corp. X and Twitter are trademarks of X Corp.

The source code is published under the MIT license. Please report problems as an Issue.
```

## 3. 掲載ページのそのほかの欄

| 欄 | 値 |
|---|---|
| ショップ アイコン（必須） | 128×128。**パッケージの中のアイコンとは別枠**で、ZIP を上げても自動では入らない |
| カテゴリ | 仕事効率化（Productivity） |
| スクリーンショット | 1280×800 を4枚（メニュー / 開いた結果 / 使い方 / 動作範囲と権限） |
| プロモーション タイル（小・440×280） | 任意 |
| マーキー プロモーション タイル（1400×560） | 任意（未作成） |
| 公式 URL | なし（確認済みドメインを持つ場合の欄） |
| ホームページ URL | `https://github.com/Driedsandwich/postcloak` |
| サポート URL | `https://github.com/Driedsandwich/postcloak/issues` |
| プライバシーポリシー URL | `https://github.com/Driedsandwich/postcloak/blob/main/PRIVACY.md` |

## 4. 単一目的と権限の正当化

### 単一目的

```
x.com のポストを、そのポストのURLでシークレットウィンドウに開くこと。これが本拡張の唯一の機能です。
```

```
To open a post on x.com in an Incognito window, using that post's own URL.
That is the extension's only function.
```

### `contextMenus`

```
右クリックメニューに項目を1つ追加するためだけに使用します。項目を出す範囲は x.com / www.x.com / twitter.com / www.twitter.com のページに限定しており（documentUrlPatterns）、他のサイトでは表示されません。
```

### `scripting`

```
拡張のインストールまたは更新より前から開かれていたタブへ、content script を入れ直すためだけに使用します。Chrome は既存のタブへ遡って content script を注入しないため、これが無いとインストール直後の右クリックが無反応になります。コード上は background.js の reviveContentScript 関数の1箇所からのみ呼び出しており、他の用途には使用しません。
```

### ホスト権限（`https://x.com/*` ほか3件）

```
ポストのURLを割り出す処理と、上記 scripting による content script の入れ直しを、x.com / www.x.com / twitter.com / www.twitter.com の4つのドメインに限定するために宣言しています。<all_urls> や広域のパターンは使用していません。
```

### リモートコードの使用

**「いいえ」**。外部スクリプトの読み込み、`eval()` による遠隔文字列の実行、CDN からのライブラリ取得のいずれも行っていません。

## 5. データの取り扱いと、ダッシュボードでの申告

ここは**「コードから確定できる事実」と「人間が画面を見て決めること」を分けて**書きます。ダッシュボードのフォームは非公開の画面で、文言も改定されるため、コードだけを根拠にチェック内容を確定できません。

### 5.1 実装上の事実（コードから確定できる）

- 利用者が右クリックまたは Shift+Alt クリックしたとき、その位置の周辺の DOM を**端末内で読む**
- そこからポストのURLを**1件だけ**取り出す。URLには投稿者にあたる部分（`/<利用者名>/`）が含まれる
- 右クリック経路では、取り出したURL1件をそのタブのメモリに**最大60秒だけ**置く。一度使うか、失効するか、ページを離れると捨てる
- 開発者・独自サーバー・第三者へ**送信しない**
- **永続保存しない**（ディスクにも `chrome.storage` にも書かない）
- 利用者がポストを開いたときは、Chrome がそのURLへ**通常どおりページを読み込む**

> **注意**: Chrome ウェブストアの「取り扱う（handle）」は**収集・送信・使用・共有**の4つを指し、**端末内だけの処理でも開示が必要**です（公式 User Data FAQ）。「外部送信がない」ことは「何も取り扱っていない」ことを意味しません。**「収集とは端末外への転送のこと」と読み替えて申告を決めないこと。**

### 5.2 ダッシュボードで人間が決めること

**フォームに添えられている現行の定義文を読んでから決めてください。** 過小申告は拒否事由になりますが、過大申告は拒否事由になりません。

| 項目 | 決め方 |
|---|---|
| **ウェブサイトのコンテンツ** | **必ず再評価する。** 本拡張は DOM を端末内で読む。現行フォームの定義が端末内の使用を含むかを確認する |
| **ウェブ閲覧履歴** | **必ず再評価する。** 公式 FAQ は「利用者が要求・操作したウェブリソースの情報（ドメインやURLを含む）」を user data の例に挙げている。ポストURLの一時的な使用がこの定義に当たるかを、現行フォームの文言で確認する |
| 個人を特定できる情報／健康／金融・決済／認証情報／個人的な通信内容／位置情報／ユーザーの操作 | 実装上、いずれも扱っていない |
| 限定利用（Limited Use） | チェックを入れる。準拠文は [PRIVACY.md](./PRIVACY.md) §7 に日英とも記載済み |

### 5.3 前回（2026-08-03 提出時）に申告した内容の記録

これは**当時そう申告したという記録**であり、現行フォームでの正しさを保証するものではありません。次回の提出前に 5.2 のとおり再確認してください。

| 項目 | 2026-08-03 の申告 |
|---|---|
| 個人を特定できる情報 | 収集しない |
| 健康情報 | 収集しない |
| 金融・決済情報 | 収集しない |
| 認証情報 | 収集しない |
| 個人的な通信内容 | 収集しない |
| 位置情報 | 収集しない |
| ウェブ閲覧履歴 | 収集しない |
| ユーザーの操作 | 収集しない |
| ウェブサイトのコンテンツ | 収集しない |
| 限定利用 | チェックあり |

確認した日付と画面の記録は、**このリポジトリの外**（提出用の素材を置いてある場所）に残してください。ダッシュボードの画面には、公開ページに出さない情報が含まれます。

## 6. 審査用のテスト手順（Provide test instructions 欄）

x.com のタイムラインはログインしないと表示されません。資格情報は渡さず、ログアウト状態でも表示される公開プロフィールページを指定しています。

```
This extension only works on x.com / twitter.com.

1. Open https://x.com/NASA (a public profile; no login required to see posts).
2. Right-click on the text of any post (not on a link).
   → A menu item "Open this post in an Incognito window (Shift+Alt click)" appears.
   Note: Chrome's own "Open link in Incognito window" does NOT appear there, because
   the post body is a <div>, not an <a>. That gap is what this extension fills.
3. Click it. The post opens in an Incognito window.
4. Alternatively, Shift+Alt click on the text of any post. Same result.
5. Right-click anywhere outside a post (e.g. the sidebar) and choose the same item.
   → A short notice appears at the bottom of the page; no window opens.

The menu item does not appear on any site other than x.com / twitter.com.
No network requests are made to any server by the extension itself.
```

## 7. 更新を出すときの手順

1. `manifest.json` の `version` を上げる（**同一以下のバージョンは再アップロードを拒否される**）。`package.json` の `version` も同じ値にする（`npm test` が食い違いを検出します）
2. `npm test` と `npm run check` を通す
3. [SMOKE.md](./SMOKE.md) の手動確認を、実機の Chrome で行い、表を埋める
4. `npm run package` で `dist/` に ZIP を作る（コミット後に作ること。未コミットの変更があると警告が出ます）
5. ダッシュボードでパッケージを差し替える。**ショップ アイコンはパッケージとは別枠**なので、意匠を変えたときは個別に上げ直す
6. 掲載文を変えたときは、このファイルの §1 / §2 と、実際の掲載ページの両方を同じ内容にする
7. データ収集の申告（§5）を維持する
8. 自動公開を ON にしておくと、審査を通った時点でそのまま公開される（OFF にすると通過から30日以内の手動公開が必要で、過ぎるとドラフトへ戻る）

却下されたときは、拡張に紐づく公開者メールアドレスへ通知が届きます。通過したときは通知されず、掲載ページの表示が変わることで分かります。

---

# 付録: なぜこの文面なのか

**単一目的を1文に固定した理由** — 「追跡防止」「複数アカウントの切り替え」などの副次的な効能を足すと、審査で別目的の抱き合わせと読まれる余地を自分で作ることになります。単一目的は説明文ではなく実装と権限で判定されるため、権限を `contextMenus` と `scripting` の2つに絞ったこと自体が最大の主張になります。

**効能表現を採らなかった理由** — 「ログイン画面をスキップ」「追跡されずに」といった書き方は、ウェブストアの「ログイン制限の迂回を助けてはならない」に正面から抵触します。一方で削り過ぎは Misleading Metadata 側のリスクになるため、**機構の記述**（何を押すと何が起きるか）に統一しました。「セッション分離」「ログイン中のアカウントと切り離して読む」も効能表現にあたるので採っていません。

**プライバシーポリシーが必須である理由** — ウェブストアの "handle" は「収集・送信・**使用**・共有」の4つを指し、公式の User Data FAQ が「ローカル処理だけでも開示が必要」と明記しています。「外部送信ゼロだから記入不要」とは主張できません。

**2026-08-01 施行のポリシー改定** — Limited Use と開示要件が厳格化されました。根拠: https://developer.chrome.com/blog/cws-policy-updates-2026
