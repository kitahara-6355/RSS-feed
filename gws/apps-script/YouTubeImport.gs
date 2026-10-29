/**
 * YouTubeImport.gs — Google データエクスポート（Takeout）の「登録チャンネル.csv」から
 * YouTube チャンネルのRSSを フィード シートに取り込む。
 *
 * YouTube はチャンネルごとに無料のRSS（新着15本）を出しているので、API もキーも要らない。
 * 取り込んだ行は 有効=オフ で入る。見たいチャンネルだけチェックを入れる。
 */

// チャンネル名からカテゴリを推測する規則。上から順に最初に当たったものを使う。
// カテゴリ名は Drive「Youtube」フォルダの再生リストのジャンル分けに合わせている。
var YOUTUBE_CATEGORY_RULES = [
  ['AI・DX', ['AI', 'OpenAI', 'DX', 'デジタル庁', 'SENSORS', 'データソリューション', 'アイデミー', 'Unreal']],
  ['専門スキル01_デジタル全般', ['プログラミング', 'Programming', 'Progate', 'エンジニア', 'パソコン', 'エクセル', 'ユースフル', 'キノコード', 'IT', 'Windows', 'Hack']],
  ['専門スキル03_税金', ['税', '国税', '財務省', '相続', '補助金', '行政書士', '資格']],
  ['経済・ビジネス', ['経済', 'ビジネス', 'BIZ', 'NewsPicks', 'PIVOT', 'リハック', 'ReHacQ', 'ワールドビジネス', 'GLOBIS', '事業', 'リベラルアーツ', 'サラタメ', 'ホリエモン', '堀江', '中島聡', '落合陽一', 'プレゼン']],
  ['専門スキル02_年収up', ['仮想通貨', 'クリプト', 'Crypto', 'ビットコイン', 'Web3', 'WEB3', 'FIRE', 'エアドロ', 'Airdrop', '億り人', 'トレード']],
  ['政治・社会', ['党', '政治', 'ニュース', '新聞', '高市', '橋下', '石丸', '立花', '安野', '上念', '髙橋洋一', '高橋洋一', '池上', '虎ノ門', '経済産業省', '農林水産省', 'くらら', '文化人']],
  ['勉強スキル', ['授業', '大学', '学長', 'スタディ', '教養', '学び', '数学', 'Stardy', '知識', 'Historia']],
  ['運動系01_バド', ['バドミントン', 'Badminton', 'badminton', 'Shuttle', 'Yonex', '桃', 'Cầu Lông']],
  ['運動系02_ゴルフ', ['ゴルフ', 'Golf']],
  ['運動系03_その他', ['筋トレ', 'Muscle', 'ビリヤード', 'DARTS', 'Baseball', '武井壮']],
  ['趣味嗜好', ['麻雀', 'Mリーグ', 'M.LEAGUE', 'パチ', 'スロ', 'ポーカー', 'マジック', 'マジシャン', 'ゲーム', 'Gaming', 'パズドラ', '漫画', 'オタク', 'Game']],
  ['生活習慣改善', ['料理', '飯', 'Cooking', '節約', 'DIY', 'ライフハック', 'ウェザー', 'ペット']],
  ['書道・文化', ['書道', '文学']]
];

var RssYouTube = (function () {
  function feedUrl(channelId) {
    return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
  }

  /** Takeout の CSV（チャンネル ID, チャンネルの URL, チャンネルのタイトル）を読む。 */
  function parseSubscriptions(csvText) {
    var rows = Utilities.parseCsv(String(csvText).replace(/^﻿/, ''));
    return rows.slice(1).filter(function (r) {
      return /^UC[\w-]{22}$/.test(String(r[0]).trim());
    }).map(function (r) {
      return { channelId: String(r[0]).trim(), title: String(r[2] || '').trim() };
    });
  }

  function guessCategory(title) {
    for (var i = 0; i < YOUTUBE_CATEGORY_RULES.length; i++) {
      var rule = YOUTUBE_CATEGORY_RULES[i];
      for (var j = 0; j < rule[1].length; j++) {
        if (title.indexOf(rule[1][j]) !== -1) return rule[0];
      }
    }
    return '未分類';
  }

  return { feedUrl: feedUrl, parseSubscriptions: parseSubscriptions, guessCategory: guessCategory };
})();

/** フィード シートに追加する。既にあるURLは飛ばす。戻り値は追加件数。 */
function importYoutubeSubscriptionsFromCsv(csvText) {
  Store.ensureSchema();
  var sh = Store.sheet(SHEETS.FEEDS);
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[r[0]] = true; });
  }
  var rows = RssYouTube.parseSubscriptions(csvText).filter(function (c) {
    return !existing[RssYouTube.feedUrl(c.channelId)];
  }).map(function (c) {
    return [false, c.title, RssYouTube.feedUrl(c.channelId), RssYouTube.guessCategory(c.title),
      '', '', 'YouTube登録チャンネルから取り込み'];
  });
  if (rows.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange(start, 1, rows.length, 1).insertCheckboxes();
  }
  Store.log('YouTube取り込み', 'OK', rows.length + '件追加');
  return rows.length;
}

/** メニューから: Drive 上の 登録チャンネル.csv のURLかIDを聞いて取り込む。 */
function importYoutubeSubscriptions() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('YouTube登録チャンネルの取り込み',
    'Google データエクスポートの「登録チャンネル.csv」のドライブURL（またはファイルID）を貼ってください。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var m = /[-\w]{25,}/.exec(res.getResponseText());
  if (!m) { ui.alert('ファイルIDが見つかりませんでした'); return; }
  var csv = DriveApp.getFileById(m[0]).getBlob().getDataAsString('UTF-8');
  var n = importYoutubeSubscriptionsFromCsv(csv);
  ui.alert(n + '件のチャンネルを フィード シートに追加しました（有効はオフ）。見たいものにチェックを入れてください。');
}
