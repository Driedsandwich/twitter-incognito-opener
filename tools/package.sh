#!/usr/bin/env bash
# ストア提出用の ZIP を作る。
#
#   npm run package
#
# 入るファイルは下の一覧だけ。ディレクトリ単位では入れない。
# 以前は `_locales` と `icons` を `zip -r` で丸ごと入れていたため、
# 置いたおぼえのないファイル（作業メモ・元画像など）が公開用の ZIP へ
# 黙って混ざった。実際に icons/ へ未追跡のテキストを1つ置いて実行すると、
# 警告は出るものの終了コード 0 で ZIP に同梱された。
#
# そのため、提出対象が HEAD と一致しない場合は**警告ではなく失敗**にする。
# 手元の変更を固めて確かめたいときだけ、明示的に
#   POSTCLOAK_ALLOW_DIRTY_PACKAGE=1 npm run package
# を使う。この場合の出力は名前に UNCOMMITTED が入り、提出には使えない。
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(
  manifest.json
  post-url.js
  background.js
  content.js
  _locales/en/messages.json
  _locales/ja/messages.json
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
  LICENSE
)

fail() {
  echo "エラー: $*" >&2
  exit 1
}

for tool in zip unzip node git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool が見つかりません（この手順には $tool が要ります）"
  fi
done

# ---------- 1. 提出対象そのものの検査 ----------

for f in "${FILES[@]}"; do
  if [ -L "$f" ]; then
    fail "$f がシンボリックリンクです。提出物には実体だけを入れます"
  fi
  if [ ! -f "$f" ]; then
    fail "提出対象の $f がありません"
  fi
done

# ---------- 2. HEAD と一致しているか ----------

dirty=""

for f in "${FILES[@]}"; do
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    dirty="提出対象 $f が git の管理下にありません"
  fi
done

if [ -z "$dirty" ] && ! git diff --quiet HEAD -- "${FILES[@]}"; then
  dirty="提出対象に未コミットの変更があります"
fi

VERSION=$(node -p "require('./manifest.json').version")
COMMIT=$(git rev-parse HEAD)

if [ -n "$dirty" ]; then
  if [ -z "${POSTCLOAK_ALLOW_DIRTY_PACKAGE:-}" ]; then
    fail "$dirty。
       公開用の ZIP は、コミットしてから作り直してください。
       いまの作業ツリーを固めて確かめたいだけなら、
         POSTCLOAK_ALLOW_DIRTY_PACKAGE=1 npm run package
       を使ってください（提出に使えない名前の ZIP になります）。"
  fi
  OUT="dist/postcloak-${VERSION}-UNCOMMITTED.zip"
  echo "############################################################" >&2
  echo "#  これは提出用ではありません。" >&2
  echo "#  作業ツリーをそのまま固めただけの ZIP です。" >&2
  echo "#  理由: $dirty" >&2
  echo "############################################################" >&2
else
  OUT="dist/postcloak-${VERSION}.zip"
fi

# ---------- 3. 名指しした一覧だけを別の場所へ集めてから固める ----------

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

for f in "${FILES[@]}"; do
  mkdir -p "$STAGE/$(dirname "$f")"
  cp "$f" "$STAGE/$f"
done

mkdir -p dist
rm -f "$OUT"
OUT_ABS="$(cd dist && pwd)/$(basename "$OUT")"
(cd "$STAGE" && zip -q -X "$OUT_ABS" "${FILES[@]}")

# ---------- 4. 出来上がった ZIP の中身を一覧と突き合わせる ----------

actual=$(unzip -Z1 "$OUT" | LC_ALL=C sort)
expected=$(printf '%s\n' "${FILES[@]}" | LC_ALL=C sort)

if [ "$actual" != "$expected" ]; then
  echo "--- 入るはずだったもの ---" >&2
  printf '%s\n' "$expected" >&2
  echo "--- 実際に入ったもの ---" >&2
  printf '%s\n' "$actual" >&2
  rm -f "$OUT"
  fail "ZIP の中身が一覧と一致しません"
fi

if ! unzip -tqq "$OUT" >/dev/null 2>&1; then
  rm -f "$OUT"
  fail "ZIP が壊れています（unzip -t が失敗）"
fi

if command -v shasum >/dev/null 2>&1; then
  SHA=$(shasum -a 256 "$OUT" | cut -d' ' -f1)
else
  SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
fi

echo "作成: $OUT"
echo "  version : $VERSION"
echo "  commit  : $COMMIT"
echo "  SHA-256 : $SHA"
echo "  ファイル数: $(printf '%s\n' "${FILES[@]}" | wc -l | tr -d ' ')"
echo "--- 実際に入ったファイル ---"
printf '%s\n' "$actual"
