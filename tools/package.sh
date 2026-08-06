#!/usr/bin/env bash
# ストア提出用の ZIP を作る。
#
#   npm run package
#
# 入るファイルは tools/package-files.txt の一覧だけ。ディレクトリ単位では入れない。
#
# 通常モードは **HEAD のコミット内容から**作る（作業ツリーからコピーしない）。
# 配布する一覧も、名前に入れる version も、**HEAD から読む**。
# 作業ツリー側の一覧や manifest を基準にすると、HEAD に無い内容が
# 「このコミットで作った」という名前の成果物を決めてしまう。
#
# 出来上がった ZIP は展開して、各ファイルが HEAD の中身とバイト単位で
# 一致することまで検査する。`.git/info/attributes` などによる意図しない
# 変換（改行の置換、`export-subst` によるキーワード展開）を見つけるため。
#
# 作業ツリーが HEAD と一致していることの判定は、`git diff` だけに頼らない。
# `assume-unchanged` と `skip-worktree` が立っていると、実際に変更があっても
# `git diff --quiet HEAD --` は成功し `git status --short` も空になる（実測済み）。
# そこで `git ls-files -v` の印を見て、印のあるファイルが1件でもあれば
# 通常モードを止める。
#
# 再現性については、同一の toolchain で作り直したときに一致することを
# テストで確かめ、成果物の SHA-256 と git の版を出力に残す。
# **異なる git の版・圧縮実装のあいだで SHA-256 が一致することは保証しない。**
# （実測: 同じコミット dc4a622 でも git 2.50.1 と 2.54.0 で SHA-256 が違った）
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
BUILD_LOGIC="tools/package.sh tools/package-files.txt package.json manifest.json"

STAGE=""
TMP_ARCHIVE=""
EXPECTED_DIR=""
EXTRACT_DIR=""
WORK_DIR=""

# 最後まで到達したときだけ 1 になる。cleanup はこれを見る。
COMPLETED=0

# 後始末で終了コードを書き換えないこと。
# 最初に $? を控えて最後に明示的に返さないと、片付けの判定が成功したせいで
# 失敗が「成功」として外に出る（実際にこれを作り込んで、dirty な作業ツリーから
# 提出用の ZIP ができてしまった）。
#
# さらに、$? を見るだけでは足りない。bash 3.2 で set -u の展開エラーが起きると、
# シェルは止まるのに EXIT トラップから見える $? は 0 のままで、そのまま
# exit 0 になる（実測: 同じ処理をトラップ無しで走らせると 1）。
# つまり「途中で死んだ」を成功として外へ出せてしまう。
# 最後まで到達した印を別に持ち、印が無いのに $? が 0 なら 1 へ倒す。
cleanup() {
  status=$?
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
  if [ -n "$EXPECTED_DIR" ]; then rm -rf "$EXPECTED_DIR"; fi
  if [ -n "$EXTRACT_DIR" ]; then rm -rf "$EXTRACT_DIR"; fi
  if [ -n "$WORK_DIR" ]; then rm -rf "$WORK_DIR"; fi
  if [ -n "$TMP_ARCHIVE" ]; then rm -f "$TMP_ARCHIVE"; fi
  if [ "$COMPLETED" != 1 ] && [ "$status" -eq 0 ]; then
    echo "エラー: 最後まで到達せずに終了しました（終了コードを 1 にします）" >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "エラー: $*" >&2
  exit 1
}

# ---------- 1. 道具とリポジトリ ----------

for tool in zip unzip node git cmp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool が見つかりません（この手順には $tool が要ります）"
  fi
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "git リポジトリの中で実行してください"
fi

if ! COMMIT=$(git rev-parse HEAD 2>/dev/null); then
  fail "HEAD を読めません（コミットが1つもない可能性があります）"
fi
if ! SHORT_COMMIT=$(git rev-parse --short=12 HEAD 2>/dev/null); then
  fail "HEAD の短縮形を読めません"
fi

WORK_DIR=$(mktemp -d)

# ---------- 2. 作られ方を決めるファイルが追跡されているか ----------

dirty=""

for f in $BUILD_LOGIC; do
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    dirty="$f が git の管理下にありません"
  fi
done

# ---------- 3. index の印を見る（git diff より先に）----------
#
# assume-unchanged（小文字の印）と skip-worktree（S）が立っていると、
# 変更があっても git diff も git status も何も言わない。
# 提出物の由来を主張する以上、ここは印そのものを見て止める。
if [ -z "$dirty" ]; then
  if ! git ls-files -v -z > "$WORK_DIR/ls-files-v"; then
    fail "git ls-files -v を実行できませんでした"
  fi

  flagged=""
  while IFS= read -r -d '' entry; do
    marker=${entry:0:1}
    path=${entry:2}
    # 小文字は明示的に並べる。[a-z] と書くと、ロケールの照合順序によっては
    # 大文字（H など）にも一致してしまい、印の無いファイルまで止めてしまう。
    case "$marker" in
      [abcdefghijklmnopqrstuvwxyz] | S)
        flagged="${flagged}  ${marker} ${path}
"
        ;;
    esac
  done < "$WORK_DIR/ls-files-v"

  if [ -n "$flagged" ]; then
    echo "--- index に印のついたファイル ---" >&2
    printf '%s' "$flagged" >&2
    dirty="index に assume-unchanged / skip-worktree の印がついたファイルがあります（git diff では見えません）"
  fi
fi

# ---------- 4. 作業ツリーが HEAD と一致しているか ----------

if [ -z "$dirty" ] && ! git diff --quiet HEAD --; then
  dirty="追跡ファイルに未コミットの変更があります"
fi

# ---------- 5. モードを決める ----------

# dist が置き換えられていないか。シンボリックリンクだと、成果物が
# 気づかないうちにリポジトリの外へ書き出される。
if [ -L dist ]; then
  fail "dist がシンボリックリンクです"
fi
if [ -e dist ] && [ ! -d dist ]; then
  fail "dist がディレクトリではありません"
fi

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
  MODE=dirty
else
  MODE=release
fi

# ---------- 6. 配布する一覧と version を読む ----------
#
# 通常モードは HEAD から読む。作業ツリーの一覧・manifest は使わない。

if [ "$MODE" = release ]; then
  if ! git show "HEAD:$FILES_LIST" > "$WORK_DIR/package-files.txt"; then
    fail "HEAD から $FILES_LIST を取得できません"
  fi
  LIST_SOURCE="$WORK_DIR/package-files.txt"

  if ! git show HEAD:manifest.json > "$WORK_DIR/manifest.json"; then
    fail "HEAD から manifest.json を取得できません"
  fi
  if ! VERSION=$(node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(x.version||""))' "$WORK_DIR/manifest.json" 2>/dev/null); then
    fail "HEAD の manifest.json から version を読めませんでした"
  fi
else
  if [ ! -f "$FILES_LIST" ]; then
    fail "$FILES_LIST がありません"
  fi
  LIST_SOURCE="$FILES_LIST"

  if ! VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null); then
    fail "manifest.json から version を読めませんでした（JSON として壊れている可能性があります）"
  fi
fi

if [ -z "$VERSION" ]; then
  fail "manifest.json の version が空です"
fi

# 何を基準に作ろうとしているかを、失敗する前に出しておく。
# あとの検査で止まったとき、「どの version をどこから読んだか」が
# 記録に残らないと、名前だけ見て取り違える。
if [ "$MODE" = release ]; then
  echo "対象: commit ${SHORT_COMMIT} / version ${VERSION}（いずれも HEAD 由来）" >&2
else
  echo "対象: version ${VERSION}（作業ツリー由来）" >&2
fi

# bash 3.2 でも動くように mapfile は使わない
FILES=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '' | '#'*) continue ;;
  esac
  FILES+=("$line")
done < "$LIST_SOURCE"

if [ "${#FILES[@]}" -eq 0 ]; then
  fail "$LIST_SOURCE に配布するファイルが1つも書かれていません"
fi

# ---------- 7. 一覧の書き方そのものを検査する ----------
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

# ---------- 8. 提出対象そのものの検査 ----------

for f in "${FILES[@]}"; do
  if [ -L "$f" ]; then
    fail "$f がシンボリックリンクです。提出物には実体だけを入れます"
  fi
  if [ ! -f "$f" ]; then
    fail "提出対象の $f がありません"
  fi
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    fail "提出対象の $f が git の管理下にありません"
  fi
done

mkdir -p dist

if [ "$MODE" = dirty ]; then
  OUT="dist/postcloak-${VERSION}-UNCOMMITTED.zip"
  echo "############################################################" >&2
  echo "#  これは提出用ではありません。" >&2
  echo "#  作業ツリーをそのまま固めただけの ZIP です。" >&2
  echo "#  理由: $dirty" >&2
  echo "############################################################" >&2
else
  # 版の番号だけでは中身を特定できない（同じ版のまま中身が変わる）。
  # 名前にコミットを入れて、展開物と記録を突き合わせられるようにする。
  OUT="dist/postcloak-${VERSION}-${SHORT_COMMIT}.zip"
fi

# 出力先そのものの型も、作り始める前に見る。
# ここで見ておくと、中身を全部作ってから最後に落ちるのを避けられる。
# 最終確認は §12 でもう一度行う（作っている間に置き換えられる可能性があるため）。
if [ -L "$OUT" ]; then
  fail "出力先 ${OUT} がシンボリックリンクです"
fi
if [ -e "$OUT" ] && [ ! -f "$OUT" ]; then
  fail "出力先 ${OUT} が通常のファイルではありません"
fi

# ---------- 9. 一時ファイルへ作る（最終的な名前へは最後に移す）----------

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

# ---------- 10. 中身を一覧と突き合わせる ----------

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

# ---------- 11. 中身が HEAD と同じか、バイト単位で確かめる ----------
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

  # 作られ方を決めるファイルも、作業ツリーと HEAD で同じであることを直接見る。
  # index の印の検査と二重になるが、狙いは「clean かどうかの判断を
  # git の index の情報だけに頼らない」こと。
  for f in $BUILD_LOGIC; do
    if ! git show "HEAD:$f" > "$WORK_DIR/build-logic-blob"; then
      fail "HEAD から $f を取得できません"
    fi
    if ! cmp -s "$WORK_DIR/build-logic-blob" "$f"; then
      fail "$f が HEAD の中身と一致しません（index の印で隠されている可能性があります）"
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

# ---------- 12. 全部通ってから、最終的な名前へ移す ----------
#
# `mv A B` は B がディレクトリだと「B の中へ入れる」に化ける。実測では、
# B がディレクトリでも、ディレクトリへのシンボリックリンクでも mv は成功し、
# ZIP は B の中（リンクならリポジトリの外）へ置かれた。
# それでも表示は「作成: B」のままなので、**提出物ができたという主張だけが嘘になる**。
#
# そこで mv を使わず、ファイル同士の置き換えとして扱う。
# 置く前に相手の型を見て、置いたあとにもう一度型と中身を確かめる。
if ! node -e '
  const fs = require("fs");
  const crypto = require("crypto");
  // node -e では、渡した引数は argv[1] から並ぶ（argv[0] は node 自身）
  const [tmp, out, expected] = process.argv.slice(1);
  const die = (m) => { console.error(m); process.exit(1); };

  let before = null;
  try {
    before = fs.lstatSync(out);
  } catch (e) {
    if (e.code !== "ENOENT") die("出力先を調べられません: " + e.message);
  }
  if (before) {
    if (before.isSymbolicLink()) die("置き換え先の " + out + " がシンボリックリンクです");
    if (!before.isFile()) die("置き換え先の " + out + " が通常のファイルではありません");
  }

  try {
    fs.renameSync(tmp, out);
  } catch (e) {
    die("成果物を " + out + " へ置けませんでした: " + e.message);
  }

  const after = fs.lstatSync(out);
  const bad = after.isSymbolicLink() ? "シンボリックリンク" : !after.isFile() ? "通常のファイルではないもの" : null;
  if (bad) {
    try { fs.unlinkSync(out); } catch (e) {}
    die("置いたあとの " + out + " が" + bad + "になっています");
  }

  const sha = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
  if (sha !== expected) {
    try { fs.unlinkSync(out); } catch (e) {}
    die("置いたあとの " + out + " の SHA-256 が検査時と違います");
  }
' "$TMP_ARCHIVE" "$OUT" "$SHA"; then
  fail "成果物を ${OUT} へ置けませんでした"
fi
TMP_ARCHIVE=""

# ここまでが提出物を作る処理。以降は表示だけなので、成功の印はここで立てる。
COMPLETED=1

echo "作成: $OUT"
if [ "$MODE" = release ]; then
  echo "  モード  : ${MODE}（HEAD のコミット内容から作成・一覧と version も HEAD 由来・中身が HEAD と一致することを検査済み）"
else
  echo "  モード  : ${MODE}（作業ツリーから作成・提出には使えない）"
fi
echo "  version : $VERSION"
echo "  commit  : $COMMIT"
echo "  SHA-256 : $SHA"
echo "  git     : $(git --version)"
echo "--- 実際に入ったファイル ---"
printf '%s\n' "$actual_files"
