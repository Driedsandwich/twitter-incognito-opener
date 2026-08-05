'use strict';

// post-url.js（background と content script が共有する URL パーサー）の検査。
// 依存を足さないよう Node 組み込みの node:test だけを使う。
//   実行: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { toPostUrl } = require('../post-url.js');

// 通したうえで、この形へ正規化されること。
const ACCEPTED = [
  ['https://x.com/alice/status/123', 'https://x.com/alice/status/123'],
  ['https://www.x.com/alice/status/123', 'https://www.x.com/alice/status/123'],
  ['https://twitter.com/alice/status/123', 'https://twitter.com/alice/status/123'],
  ['https://www.twitter.com/alice/status/123', 'https://www.twitter.com/alice/status/123'],
  ['https://x.com/i/web/status/123', 'https://x.com/i/web/status/123'],
  ['https://x.com/i/status/123', 'https://x.com/i/status/123'],
  ['https://x.com/Alice_1/status/123', 'https://x.com/Alice_1/status/123'],
  // ホスト名の大文字は URL 側で小文字になる
  ['https://X.COM/alice/status/123', 'https://x.com/alice/status/123'],
  // 派生ページはポスト本体へ戻す
  ['https://x.com/alice/status/123/photo/1', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123/video/1', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123/analytics', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123/likes', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123/retweets', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123/quotes', 'https://x.com/alice/status/123'],
  ['https://x.com/i/web/status/123/photo/2', 'https://x.com/i/web/status/123'],
  // 末尾のスラッシュは同じポスト
  ['https://x.com/alice/status/123/', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123/photo/1/', 'https://x.com/alice/status/123'],
  // クエリとフラグメントは落とす
  ['https://x.com/alice/status/123?utm_source=a#fragment', 'https://x.com/alice/status/123'],
  ['https://x.com/alice/status/123?s=20', 'https://x.com/alice/status/123'],
  // 既定ポートと空の資格情報は URL 側で消えるので、正規化した形が残る
  // （実測 Node 22.22.3: :443 → port ""、:@ → username/password とも ""）
  ['https://x.com:443/alice/status/123', 'https://x.com/alice/status/123'],
  ['https://:@x.com/alice/status/123', 'https://x.com/alice/status/123'],
];

const REJECTED = [
  // 監査指示書（2026-08-04）が挙げた異常系
  'http://x.com/alice/status/123',
  'https://evil.example/alice/status/123',
  'https://x.com.evil.example/alice/status/123',
  'https://x.com/alice/status/notdigits',
  'https://x.com/alice/status/123abc',
  'https://x.com/alice/status/123/evil',
  'https://x.com/alice/status/123/photo/1/evil',
  'https://x.com:444/alice/status/123',
  'https://alice:secret@x.com/alice/status/123',
  'javascript:alert(1)',
  'data:text/html,test',
  // 監査の一覧の外から足した形（検出範囲そのものを疑うため）
  'https://x.com/status/123',
  'https://x.com/alice/status/',
  'https://x.com/alice/statuses/123',
  'https://x.com/alice/status/123/analytics/likes',
  'https://x.com/i/status/notdigits',
  'https://x.com/i/zzzz/status/123',
  'https://pro.x.com/alice/status/123',
  'https://x.com./alice/status/123',
  'https://x.com/alice/status/123%2Fevil',
  'https://x.com/alice.bob/status/123',
  'ftp://x.com/alice/status/123',
  '/alice/status/123', // base を渡さなければ相対URLは解釈しない
  '',
];

test('通すべきURLを通し、ポスト本体の形へ正規化する', () => {
  for (const [input, expected] of ACCEPTED) {
    assert.equal(toPostUrl(input), expected, `通らなかった: ${input}`);
  }
});

test('弾くべきURLを弾く', () => {
  for (const input of REJECTED) {
    assert.equal(toPostUrl(input), null, `通ってしまった: ${input}`);
  }
});

test('文字列でない入力で例外を投げない', () => {
  for (const input of [null, undefined, 0, 123, {}, [], true, NaN]) {
    assert.equal(toPostUrl(input), null, `null を返さなかった: ${String(input)}`);
  }
});

test('base を渡したときだけ相対URLを解釈する', () => {
  const base = 'https://x.com/home';
  assert.equal(toPostUrl('/alice/status/123', base), 'https://x.com/alice/status/123');
  assert.equal(toPostUrl('/alice/status/123/photo/1', base), 'https://x.com/alice/status/123');
  // base があっても、行き先が許可ホストの外なら通さない
  assert.equal(toPostUrl('//evil.example/alice/status/123', base), null);
  assert.equal(toPostUrl('https://evil.example/alice/status/123', base), null);
  // 相対URLは base 無しでは通らない
  assert.equal(toPostUrl('/alice/status/123'), null);
});

test('許可ホストの一覧が4つのまま変わっていない', () => {
  const { ALLOWED_HOSTS } = require('../post-url.js');
  assert.deepEqual([...ALLOWED_HOSTS].sort(), [
    'twitter.com',
    'www.twitter.com',
    'www.x.com',
    'x.com',
  ]);
});
