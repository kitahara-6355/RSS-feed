# RSS学習ログ（GWS版）

旧版（Python ＋ GitHub Actions ＋ Notion ＋ Gemini API、2025-10-19 で自動実行が停止）を、
Google Workspace の定額枠の中で動く形に作り直した試作です。

| | 旧版 | GWS版 |
| --- | --- | --- |
| 実行場所 | GitHub Actions | Apps Script の時間トリガー（毎日1回＋毎週の学習） |
| 保存先 | Notion データベース | スプレッドシート（記事・フィード・興味キーワード・設定・ログ） |
| フィード管理 | `src/config.py` ／ Notion のチェックボックス | フィード シートの 有効 チェック |
| 分類 | Gemini でタグ生成 | 興味キーワード による分類（費用ゼロ）。AIは任意 |
| 要約 | Gemini API（本文をスクレイピング） | 方式を選択: なし ／ Sheets AI（人が生成を押す） ／ Gemini無料API |
| 学習 | `learn_from_feedback.py` | 同じ計算式を `runLearn` に移植 |
| 鍵 | `.env` と GitHub Secrets | 不要。Gemini無料APIを使うときだけスクリプトプロパティにキー |

## 構成

```
gws/
  apps-script/
    RssCore.gs     取得と解析だけの部品（シートにもAIにも依存しない）
    Store.gs       シートの読み書き
    Classify.gs    キーワード分類と、要約方式の切り替え
    Main.gs        メニュー・自動実行・学習
    Seed.gs        旧版のフィード22件と興味キーワード109件
    YouTubeImport.gs  YouTube登録チャンネル（Takeout の CSV）をフィードとして取り込む
    appsscript.json
  skills/rss-learning-log/SKILL.md   Claude Code / Gemini Skills 用の運用手順
  test/            Node で .gs を動かすテスト（node --test）
```

`RssCore` は SNS自動管理ダッシュボードの「RSS取得」部分としてそのまま使えるように分けています。

```js
// 別プロジェクトから: RssCore.gs をコピーするか、ライブラリとして追加する
const items = RssCore.fetchFeed('https://www.youtube.com/feeds/videos.xml?channel_id=...', { source: '競合A' });
const results = RssCore.fetchFeeds([{ name: 'A', url: '...' }, { name: 'B', url: '...' }]); // 1件の失敗で止まらない
```

フィード シートの 用途 列で「学習」と「SNS監視」などを分けておけば、`Store.feeds('SNS監視')` で
ダッシュボード側の監視対象だけを取り出せます（この試作の `runFetch` は「学習」だけを取得します）。

## 導入手順（5分）

1. Google ドライブで新しいスプレッドシートを作る（Business Standard のアカウントで）。
2. 拡張機能 → Apps Script を開き、`apps-script/` の6つの `.gs` を同名ファイルとして貼り付ける。
   `appsscript.json` は「プロジェクトの設定 → appsscript.json を表示」をオンにして貼り付ける。
   clasp を使う場合は `apps-script/` を `clasp push` するだけ。
3. スプレッドシートを開き直すと「RSS学習ログ」メニューが出る。
4. メニュー → 初期設定。シートが作られ、旧版のフィードと興味キーワードが入る。
5. メニュー → 今すぐ取得。初回だけ権限の確認が出る（外部URLの取得・このシートの編集・トリガー）。
6. 問題なければ メニュー → 自動実行をオンにする（毎日6時に取得、毎週月曜5時に学習）。

### 要約方式（設定 シート）

- **なし**（初期値）: キーワード分類だけ。費用もAI枠も使わない。
- **Sheets AI**: AI要約 列に `=AI("…", E2:G2)` を書き込む。生成はシート上で人が押す
  （方針どおり「生成ボタンは人が押し、前後を自動化」）。Business Standard の Gemini 枠を使う。
- **Gemini無料API**: 旧版と同じ無料枠を使う。Apps Script の プロジェクトの設定 → スクリプト プロパティ に
  `GEMINI_API_KEY` を追加する（ファイルは作らない）。課金を有効にしていないプロジェクトのキーに限ること。
  10件ずつまとめて送り、1回の実行で `1回のAI処理上限` 件まで。無料枠の送信内容はGoogleの製品改善に
  使われるため、公開記事の要約以外には使わない。

### YouTube登録チャンネルの取り込み

YouTube はチャンネルごとに無料のRSS（`/feeds/videos.xml?channel_id=…`、新着15本）を出しているので、
APIもキーも使わずに登録チャンネルの新着を学習ログに入れられます。

1. メニュー → YouTube登録チャンネルを取り込む。
2. Google データエクスポートの「登録チャンネル.csv」のドライブURLを貼る
   （共有ドライブ「(PJ)未整理」に2025-08-10時点のものがある）。
3. フィード シートに 有効=オフ で追加される。カテゴリはチャンネル名から自動で推測
   （再生リストのジャンル分けに合わせた区分。外れたら手で直す）。見たいものだけチェックを入れる。

SNS自動管理ダッシュボードで競合チャンネルを見るときも同じ方法で取り込み、用途を「SNS監視」にします。
登録チャンネルの一覧は個人の情報なので、このリポジトリ（公開）には入れていません。

## 使い方

- 記事 シートで 興味度・重要度（1〜5）と ステータス（未読／あとで読む／完了）を付ける。
- 毎週の学習で、付けた評価からタグとフィードの重みが更新される（由来が「学習」の行だけ。手で入れた重みは変えない）。
- 関連度しきい値を上げると、興味の薄い記事は保存されなくなる（初期値0＝全件保存）。

## テスト

```
cd gws/test && npm install && node --test
```

RSS 2.0 ／ Atom（YouTube・Publickey形式）／ RSS 1.0(RDF) の解析、重複除外、しきい値、
Sheets AI の式、Gemini のまとめ送信、学習、用途での絞り込み、YouTube登録チャンネルの取り込みを確認しています。

## 旧版から持ってこなかったもの

- 本文スクレイピング（サイト変更で壊れやすく、Apps Script の実行時間も食うため）。要約はRSSの概要から作る。
- フィード推薦（`recommend_feeds.py`）と著者推測。必要になったら追加する。
- 代表画像の添付は、RSSに含まれる画像URLを 画像 列に残すだけにした。
