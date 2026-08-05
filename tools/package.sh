#!/usr/bin/env bash
# ストア提出用の ZIP を作る。
#
#   npm run package
#
# 入れるのは下の一覧だけ。テスト・CI・内部文書・package.json は入れない。
# 中身は「いま作業ツリーにあるファイル」＝テストにかけたものそのものになる。
# HEAD と食い違っているときは警告する（コミットせずに提出すると、あとから
# 同じ ZIP を作り直せなくなる）。
#
# 限界: 日時はディスク上のファイルの日時をそのまま使うので、別の環境で作った
# ZIP とバイト単位で一致することは保証しない（入るファイルの中身は一致する）。
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(
  manifest.json
  post-url.js
  background.js
  content.js
  _locales
  icons
  LICENSE
)

for f in "${FILES[@]}"; do
  if [ ! -e "$f" ]; then
    echo "エラー: 提出対象の $f がありません" >&2
    exit 1
  fi
done

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/postcloak-${VERSION}.zip"

if ! git diff --quiet HEAD -- "${FILES[@]}" ||
  [ -n "$(git ls-files --others --exclude-standard -- "${FILES[@]}")" ]; then
  echo "注意: 提出対象のファイルが HEAD と一致していません（未コミットの変更があります）。" >&2
  echo "      公開する ZIP は、コミットしてから作り直してください。" >&2
fi

mkdir -p dist
rm -f "$OUT"
zip -q -X -r "$OUT" "${FILES[@]}" -x '*.DS_Store'

echo "作成: $OUT"
echo "--- 実際に入ったファイル ---"
unzip -Z1 "$OUT" | sort
