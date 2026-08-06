#!/usr/bin/env bash
# ストア提出用の ZIP を作る。
#
#   npm run package
#
# 入るファイルは tools/package-files.txt の一覧だけ。ディレクトリ単位では入れない。
#
# 通常モードは **HEAD のコミット内容から**作る（作業ツリーからコピーしない）。
# 出来上がった ZIP は展開して、各ファイルが HEAD の中身とバイト単位で
# 一致することまで検査する。`.git/info/attributes` などによる意図しない
# 変換（改行の置換、`export-subst` によるキーワード展開）を見つけるため。
#
# 再現性については、同一の toolchain で作り直したときに一致することを
# テストで確かめ、成果物の SHA-256 と git の版を出力に残す。
# **異なる git の版・圧縮実装のあいだで SHA-256 が一致することは保証しない。**
#
# 提出対象だけでなく、**追跡ファイル全体**が HEAD と一致していることを要求する。
# 提出物そのものが同じでも、未コミットの package.sh や package.json で作った ZIP に
# HEAD のコミットIDを表示できてしまうと、「このコミットで作った」と言えなくなるため。
#
# 手元の変更を固めて確かめたいときだけ、明示的に
#   POSTCLOAK_ALLOW_DIRTY_PACKAGE=1 npm run package
# を使う。値は厳密に 1 のときだけ有効で、出力名には UNCOMMITTED が入る。
#
# 出来上がりは一時ファイルへ作り、検査を全部通ってから最終的な名前へ移す。
# 途中で失敗しても、提出名の壊れたファイルが残らないようにするため。
set -euo pipefail

cd "$(dirname "$0")/.."

FILES_LIST=tools/package-files.txt
# 提出物そのものではないが、提出物の作られ方を決めるファイル
BUILD_LOGIC="tools/package.sh tools/package-files.txt package.json"

STAGE=""
TMP_ARCHIVE=""
EXPECTED_DIR=""
EXTRACT_DIR=""

# 後始末で終了コードを書き換えないこと。
# 最初に $? を控えて最後に明示的に返さないと、片付けの判定が成功したせいで
# 失敗が「成功」として外に出る（実際にこれを作り込んで、dirty な作業ツリーから
# 提出用の ZIP ができてしまった）。
cleanup() {
  status=$?
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
  if [ -n "$EXPECTED_DIR" ]; then rm -rf "$EXPECTED_DIR"; fi
  if [ -n "$EXTRACT_DIR" ]; then rm -rf "$EXTRACT_DIR"; fi
  if [ -n "$TMP_ARCHIVE" ]; then rm -f "$TMP_ARCHIVE"; fi
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "エラー: $*" >&2
  exit 1
}

for tool in zip unzip node git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool が見つかりません（この手順には $tool が要ります）"
  fi
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "git リポジトリの中で実行してください"
fi

# ---------- 1. 配布する一覧を読む（正本は tools/package-files.txt だけ）----------

if [ ! -f "$FILES_LIST" ]; then
  fail "$FILES_LIST がありません"
fi

# bash 3.2 でも動くように mapfile は使わない
FILES=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '' | '#'*) continue ;;
  esac
  FILES+=("$line")
done < "$FILES_LIST"

if [ "${#FILES[@]}" -eq 0 ]; then
  fail "$FILES_LIST に配布するファイルが1つも書かれていません"
fi

# ---------- 2. 一覧の書き方そのものを検査する ----------
#
# 一覧はテキストなので、リポジトリの外や別の場所を指す行を書けてしまう。
# ZIP へ入れる前に、パスとして受け付けられる形かどうかを先に見る。
for f in "${FILES[@]}"; do
  case "$f" in
    /*) fail "一覧に絶対パスがあります: $f" ;;
    -*) fail "一覧の項目が - で始まっています（コマンドの引数と紛れます）: $f" ;;
    *\\*) fail "一覧にバックスラッシュを含むパスがあります: $f" ;;
  esac
  # 空白だけの行も弾く（読み込み時に落ちるのは完全な空行だけ）
  case "$f" in
    *[!' 	']*) : ;;
    *) fail "一覧に空白だけの行があります" ;;
  esac
  # `..` と `.` は、区切りで分けたうえで完全一致で見る。
  # 部分一致だと `..foo` や `a.b` まで巻き込む。
  saved_ifs=$IFS
  IFS=/
  for seg in $f; do
    case "$seg" in
      ..) IFS=$saved_ifs; fail "一覧に上位ディレクトリへの参照があります: $f" ;;
      .) IFS=$saved_ifs; fail "一覧に . の区切りを含むパスがあります: $f" ;;
      '') IFS=$saved_ifs; fail "一覧に空の区切りを含むパスがあります: $f" ;;
    esac
  done
  IFS=$saved_ifs
done

# 同じファイルを二重に書いていないか（ZIP に同名の項目が2つ入る）
i=0
while [ "$i" -lt "${#FILES[@]}" ]; do
  j=$((i + 1))
  while [ "$j" -lt "${#FILES[@]}" ]; do
    if [ "${FILES[$i]}" = "${FILES[$j]}" ]; then
      fail "一覧に同じパスが2回書かれています: ${FILES[$i]}"
    fi
    j=$((j + 1))
  done
  i=$((i + 1))
done

# ---------- 3. 提出対象そのものの検査 ----------

for f in "${FILES[@]}"; do
  if [ -L "$f" ]; then
    fail "$f がシンボリックリンクです。提出物には実体だけを入れます"
  fi
  if [ ! -f "$f" ]; then
    fail "提出対象の $f がありません"
  fi
done

# ---------- 4. HEAD と一致しているか ----------

dirty=""

for f in "${FILES[@]}" $BUILD_LOGIC; do
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    dirty="$f が git の管理下にありません"
  fi
done

# 提出対象だけでなく追跡ファイル全体を見る（理由は冒頭のコメント）
if [ -z "$dirty" ] && ! git diff --quiet HEAD --; then
  dirty="追跡ファイルに未コミットの変更があります"
fi

# 作業ツリーが HEAD と一致していることを上で確かめているので、
# 通常モードではここで読む manifest.json は HEAD のものと同じ。
if ! VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null); then
  fail "manifest.json から version を読めませんでした（JSON として壊れている可能性があります）"
fi
if [ -z "$VERSION" ]; then
  fail "manifest.json の version が空です"
fi
COMMIT=$(git rev-parse HEAD)
SHORT_COMMIT=$(git rev-parse --short=12 HEAD)

# dist が置き換えられていないか。シンボリックリンクだと、成果物が
# 気づかないうちにリポジトリの外へ書き出される。
if [ -L dist ]; then
  fail "dist がシンボリックリンクです"
fi
if [ -e dist ] && [ ! -d dist ]; then
  fail "dist がディレクトリではありません"
fi

mkdir -p dist

if [ -n "$dirty" ]; then
  # 値は厳密に 1 のときだけ。0 や true や空でない任意の文字列では通さない。
  if [ "${POSTCLOAK_ALLOW_DIRTY_PACKAGE:-}" != "1" ]; then
    # 変数の直後に日本語を続けない。bash 3.2 は "${dirty}。" と書かないと
    # 「dirty。」という名前の変数として読み、set -u で落ちる。
    fail "${dirty}。
       公開用の ZIP は、コミットしてから作り直してください。
       いまの作業ツリーを固めて確かめたいだけなら、
         POSTCLOAK_ALLOW_DIRTY_PACKAGE=1 npm run package
       を使ってください（提出に使えない名前の ZIP になります）。"
  fi
  OUT="dist/postcloak-${VERSION}-UNCOMMITTED.zip"
  MODE=dirty
  echo "############################################################" >&2
  echo "#  これは提出用ではありません。" >&2
  echo "#  作業ツリーをそのまま固めただけの ZIP です。" >&2
  echo "#  理由: $dirty" >&2
  echo "############################################################" >&2
else
  # 版の番号だけでは中身を特定できない（同じ版のまま中身が変わる）。
  # 名前にコミットを入れて、展開物と記録を突き合わせられるようにする。
  OUT="dist/postcloak-${VERSION}-${SHORT_COMMIT}.zip"
  MODE=release
fi

# ---------- 5. 一時ファイルへ作る（最終的な名前へは最後に移す）----------

# 最終出力と同じ場所に作る。別のファイルシステムだと mv が atomic にならない。
TMP_ARCHIVE=$(mktemp "dist/.postcloak-package.XXXXXX")

if [ "$MODE" = release ]; then
  # HEAD のコミット内容から直接作る。作業ツリーには触らない。
  rm -f "$TMP_ARCHIVE"
  if ! git archive --format=zip -o "$TMP_ARCHIVE" HEAD -- "${FILES[@]}"; then
    fail "git archive に失敗しました"
  fi
else
  # 手元の確認用。作業ツリーの中身をそのまま固める（日時が入るので再現しない）。
  STAGE=$(mktemp -d)
  for f in "${FILES[@]}"; do
    mkdir -p "$STAGE/$(dirname "$f")"
    if ! cp "$f" "$STAGE/$f"; then
      fail "$f を作業用の場所へ複製できませんでした"
    fi
  done
  rm -f "$TMP_ARCHIVE"
  if ! (cd "$STAGE" && zip -q -X "$OLDPWD/$TMP_ARCHIVE" "${FILES[@]}"); then
    fail "zip に失敗しました"
  fi
fi

# ---------- 6. 中身を一覧と突き合わせる ----------

# git archive はディレクトリの項目も作るので、ファイルとディレクトリを分けて見る。
if ! entries=$(unzip -Z1 "$TMP_ARCHIVE"); then
  fail "ZIP の項目一覧を取得できませんでした（unzip -Z1 が失敗）"
fi

actual_files=$(printf '%s\n' "$entries" | grep -v '/$' | LC_ALL=C sort)
expected=$(printf '%s\n' "${FILES[@]}" | LC_ALL=C sort)

if [ "$actual_files" != "$expected" ]; then
  echo "--- 入るはずだったもの ---" >&2
  printf '%s\n' "$expected" >&2
  echo "--- 実際に入ったもの ---" >&2
  printf '%s\n' "$actual_files" >&2
  fail "ZIP の中身が一覧と一致しません"
fi

# ディレクトリの項目は、一覧のどれかの親でなければおかしい
for d in $(printf '%s\n' "$entries" | grep '/$' || true); do
  ok=no
  for f in "${FILES[@]}"; do
    case "$f" in "$d"*) ok=yes ;; esac
  done
  if [ "$ok" = no ]; then
    fail "ZIP に、一覧のどれとも関係のないディレクトリ項目があります: $d"
  fi
done

if ! unzip -tqq "$TMP_ARCHIVE" >/dev/null 2>&1; then
  fail "ZIP が壊れています（unzip -t が失敗）"
fi

# ---------- 7. 中身が HEAD と同じか、バイト単位で確かめる ----------
#
# 一覧との突き合わせは「どのファイルが入ったか」しか見ない。
# `.git/info/attributes` の `export-subst` や改行の変換が効いていると、
# 名前は同じまま中身だけが変わるので、ここで実際に比べる。
if [ "$MODE" = release ]; then
  EXPECTED_DIR=$(mktemp -d)
  EXTRACT_DIR=$(mktemp -d)

  for f in "${FILES[@]}"; do
    mkdir -p "$EXPECTED_DIR/$(dirname "$f")"
    if ! git show "HEAD:$f" > "$EXPECTED_DIR/$f"; then
      fail "HEAD から $f を取得できません"
    fi
  done

  if ! unzip -q "$TMP_ARCHIVE" -d "$EXTRACT_DIR"; then
    fail "検証用の展開に失敗しました"
  fi

  for f in "${FILES[@]}"; do
    if ! cmp -s "$EXPECTED_DIR/$f" "$EXTRACT_DIR/$f"; then
      fail "ZIP の中の $f が HEAD の中身と一致しません（archive の変換が効いている可能性があります）"
    fi
  done
fi

if command -v shasum >/dev/null 2>&1; then
  if ! SHA=$(shasum -a 256 "$TMP_ARCHIVE" | cut -d' ' -f1); then
    fail "SHA-256 を計算できませんでした"
  fi
else
  if ! SHA=$(sha256sum "$TMP_ARCHIVE" | cut -d' ' -f1); then
    fail "SHA-256 を計算できませんでした"
  fi
fi

# ---------- 8. 全部通ってから、最終的な名前へ移す ----------

if ! mv -f "$TMP_ARCHIVE" "$OUT"; then
  fail "成果物を $OUT へ移せませんでした"
fi
TMP_ARCHIVE=""

echo "作成: $OUT"
if [ "$MODE" = release ]; then
  echo "  モード  : ${MODE}（HEAD のコミット内容から作成・中身が HEAD と一致することを検査済み）"
else
  echo "  モード  : ${MODE}（作業ツリーから作成・提出には使えない）"
fi
echo "  version : $VERSION"
echo "  commit  : $COMMIT"
echo "  SHA-256 : $SHA"
echo "  git     : $(git --version)"
echo "--- 実際に入ったファイル ---"
printf '%s\n' "$actual_files"
