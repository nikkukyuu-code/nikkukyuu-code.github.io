# nikkukyuu-code.github.io

ネット対戦をカジュアルに楽しめるブラウザゲームのサイト紹介ページです。

**サイト:** https://nikkukyuu-code.github.io/

## 公開中

- [スペーストリックバトル（Space Trick Battle）](https://nikkukyuu-code.github.io/shooting-online/) — 無料ブラウザオンライン対戦シューティング
- [トリックハウスバトル](https://nikkukyuu-code.github.io/househouse/)（プレイ: [/househouse/game/](https://nikkukyuu-code.github.io/househouse/game/)）
- [7GET将棋](https://nikkukyuu-code.github.io/shogi/)（プレイ: [/shogi/game/](https://nikkukyuu-code.github.io/shogi/game/)）

スペーストリックバトルはリポジトリ直下が本体です。将棋・ハウスは「ルート＝説明ページ」「`game/`＝本体」の構成です。

## 引き継ぎ（全ゲーム共通コード）

- ページ: https://nikkukyuu-code.github.io/transfer/ （`transfer/index.html` + `transfer/transfer.js`）
- 全ゲームは同じオリジン（nikkukyuu-code.github.io）のプロジェクトページなので、localStorage は1つ。ページはオリジン上の**全キー**を1つのコードにまとめる：`NK1c.<base64url(deflate-raw JSON)>.<crc32>`（`c`=圧縮、`p`=非圧縮フォールバック）。
- 除外: `*_visitLast` / `*_battleLast` / `hub_visitLast_*`（カウンター表示キャッシュ）、`*preimport*`（引き継ぎ前バックアップ）。
- 入力時は現在の全データを `nk-transfer-preimport` にバックアップしてからマージ。キーは削除しない。
- **ゲーム追加**: `transfer/transfer.js` の `GAMES` に1エントリ追加（`id`, `name`, `match(key)`, `rules`, `summary`）。
  - rule: `'max'`（数値・減らない）/ `'union'`（配列・所持品）/ `'or'`（フラグ）/ `'imported'` / `'current'` / 関数 `(cur, imp, ctx) => string|undefined`
  - ルールのないキーはコードの値を採用（デッキ・配置・設定・COMの記憶）。どのゲームにも一致しないキーは「その他」としてそのまま引き継ぐので、登録前の新作ゲームのデータも入る。
- 各ゲームのタイトル画面の「引き継ぎ」ボタンは `/transfer/?from=<ゲームのパス>` へリンク（`from` は同一オリジンのパスのみ許可、「ゲームに戻る」リンクになる）。
