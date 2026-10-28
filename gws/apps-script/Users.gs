/**
 * Users.gs — 利用者の登録。1人に1冊のブックを作り、人ごとにRSSソースと興味を分けて管理する。
 *
 * 管理用ブック（テンプレート）で「利用者を登録」を実行すると:
 *   1. このブックをコピーして「RSS学習ログ_<名前>」を作る（コードもいっしょにコピーされる）
 *   2. コピーから人ごとのデータを消し、プロフィールと初期データを入れる
 *   3. 管理用ブックの 利用者台帳 に、名前・区分・ブックのURLだけを書く（記事や興味は書かない）
 *
 * 自動実行のトリガーは本人がそのブックを開いて「自動実行をオンにする」で入れる（本人の権限で動く）。
 * 本人への共有はこの関数では行わない。ブックの共有ボタンから人が行う。
 */
var REGISTRY_SHEET = '利用者台帳';
var REGISTRY_HEADERS = ['利用者名', '区分', '初期データ', 'ブックURL', 'ブックID', '登録日', 'メモ'];

/**
 * 利用者を登録して、作ったブックのURLを返す。
 * @param {{name: string, kind: string, business: string, interests: string, preset: string, note: string}} user
 */
function registerUser(user) {
  if (!user || !user.name) throw new Error('利用者名を入れてください');
  var preset = user.preset || '空';
  if (!SEED_PRESETS[preset]) throw new Error('初期データ「' + preset + '」はありません');

  var admin = SpreadsheetApp.getActiveSpreadsheet();
  var registry = registrySheet_(admin);
  var names = registry.getLastRow() > 1
    ? registry.getRange(2, 1, registry.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  if (names.indexOf(user.name) !== -1) throw new Error(user.name + ' さんは登録済みです');

  var file = DriveApp.getFileById(admin.getId()).makeCopy('RSS学習ログ_' + user.name);
  var book = SpreadsheetApp.openById(file.getId());
  var today = new Date();
  try {
    Store.use(book);
    var copiedRegistry = book.getSheetByName(REGISTRY_SHEET);
    if (copiedRegistry) book.deleteSheet(copiedRegistry);
    Store.ensureSchema();
    Store.clearPersonalData();
    Store.setProfile({
      '利用者名': user.name,
      '区分': user.kind || '個人事業主',
      '事業・活動内容': user.business || '',
      '集めたい情報': user.interests || '',
      '初期データ': preset,
      '登録日': today
    });
    seedPreset_(preset);
    Store.log('利用者登録', 'OK', user.name + '（' + preset + '）');
  } finally {
    Store.use(null);
  }

  var url = book.getUrl();
  registry.appendRow([user.name, user.kind || '個人事業主', preset, url, file.getId(), today, user.note || '']);
  return url;
}

function registrySheet_(ss) {
  var sh = ss.getSheetByName(REGISTRY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REGISTRY_SHEET);
    sh.getRange(1, 1, 1, REGISTRY_HEADERS.length).setValues([REGISTRY_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** メニューから: 名前・区分・初期データを聞いて登録する。 */
function registerUserDialog() {
  var ui = SpreadsheetApp.getUi();
  var ask = function (title, text) {
    var res = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) throw new Error('キャンセルしました');
    return res.getResponseText().trim();
  };
  try {
    var name = ask('利用者を登録', '利用者名（例: 克洋）');
    var kind = ask('利用者を登録', '区分（空なら 個人事業主）') || '個人事業主';
    var business = ask('利用者を登録', '事業・活動内容（例: DX支援）');
    var preset = ask('利用者を登録', '初期データ: ' + Object.keys(SEED_PRESETS).join(' / ')) || '空';
    var url = registerUser({ name: name, kind: kind, business: business, preset: preset });
    ui.alert(name + ' さんのブックを作りました。\n' + url +
      '\n\n本人がこのブックを開き、メニューから「自動実行をオンにする」を押してください。共有は共有ボタンから行います。');
  } catch (e) {
    ui.alert(e.message);
  }
}
