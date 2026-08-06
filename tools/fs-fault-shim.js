// 提出物を置いたあとの検査を、テストから撃つための差し込み。
//
//   NODE_OPTIONS=--require=<このファイル> POSTCLOAK_TEST_FAULT=type|sha
//
// 置き場所と名前に注意する。`node --test` は test/ 配下の .js に加えて、
// **どこにあっても** test.js / test-*.js / *-test.js / *_test.js / *.test.js を
// テストとして実行する（実測）。tools/test-fs-fault.js は拾われてしまったので、
// この名前にしてある。
//
// `tools/package.sh` は、成果物を最終的な名前へ置いたあと、
// もう一度その型（通常のファイルか）と SHA-256 を確かめる。
// この2つは、置いた直後に外から割り込まれない限り破れないので、
// **普通のテストでは到達できない**（変異させても落ちない）。
//
// そこで、テスト側の node プロセスの中だけで `fs` を包み、
// 「置いたあとに型が変わった」「置いたあとに中身が変わった」を作る。
// 製品側のコードには何も足さない（デバッグ用の分岐を入れない）。
'use strict';

const mode = process.env.POSTCLOAK_TEST_FAULT;

if (mode === 'type' || mode === 'sha') {
  const fs = require('node:fs');

  // どのパスへ置いたかを覚える。置く前の読み書きには触らない。
  let renamed = null;
  const realRename = fs.renameSync.bind(fs);
  fs.renameSync = (from, to) => {
    const r = realRename(from, to);
    renamed = to;
    return r;
  };

  if (mode === 'type') {
    const realLstat = fs.lstatSync.bind(fs);
    fs.lstatSync = (target, ...rest) => {
      const stat = realLstat(target, ...rest);
      if (renamed !== null && target === renamed) {
        // 置いたあとの確認にだけ、通常のファイルでないものを返す
        return { isSymbolicLink: () => false, isFile: () => false };
      }
      return stat;
    };
  } else {
    const realRead = fs.readFileSync.bind(fs);
    fs.readFileSync = (target, ...rest) => {
      if (renamed !== null && target === renamed) {
        // 置いたあとの照合にだけ、別の中身を返す
        return Buffer.from('tampered after rename');
      }
      return realRead(target, ...rest);
    };
  }
}
