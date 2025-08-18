/**
 * RSSフィードを定期的にチェックし、新しい記事があれば通知するスクリプト。
 *
 * 使い方:
 * 1. RSS_URL に監視したいサイトのRSSフィードURLを設定します。
 * 2. SPREADSHEET_ID に、記事の履歴を保存するGoogleスプレッドシートのIDを設定します。
 * 3. このスクリプトのトリガーを「時間主導型」で設定し、定期的に実行されるようにします。
 */

/**
 * スプレッドシートから既存の記事IDを読み込み、Setとして返します。
 * シートが存在しない場合は作成します。
 * @param {string} spreadsheetId - GoogleスプレッドシートのID。
 * @param {string} sheetName - 履歴を保存するシート名。
 * @return {Set<string>} 既存記事のIDを格納したSet。
 */
function getExistingArticleIds(spreadsheetId, sheetName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    let sheet = spreadsheet.getSheetByName(sheetName);

    // シートが存在しない場合、ヘッダー付きで新規作成
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      sheet.appendRow(['ID', 'Title', 'Link', 'FetchedDate']);
      console.log(`シート '${sheetName}' を作成し、ヘッダー行を追加しました。`);
      return new Set();
    }

    const lastRow = sheet.getLastRow();
    // ヘッダー行しかない場合は、空のSetを返す
    if (lastRow < 2) {
      return new Set();
    }

    // A列（ID列）のデータを2行目からすべて取得
    const idRange = sheet.getRange(2, 1, lastRow - 1, 1);
    const ids = idRange.getValues().flat();

    return new Set(ids);
  } catch (e) {
    console.error(`スプレッドシート処理中にエラーが発生しました: ${e.message}`);
    throw new Error(`スプレッドシート(ID: ${spreadsheetId})の処理に失敗しました。アクセス権限やIDが正しいか確認してください。`);
  }
}

/**
 * 新着記事の情報をスプレッドシートに追記します。
 * @param {string} spreadsheetId - GoogleスプレッドシートのID。
 * @param {string} sheetName - 履歴を保存するシート名。
 * @param {Array<Object>} newArticles - 書き込む新着記事のオブジェクト配列。
 */
function appendNewArticlesToSheet(spreadsheetId, sheetName, newArticles) {
  if (!newArticles || newArticles.length === 0) {
    return;
  }

  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (!sheet) {
      // getExistingArticleIdsで作成されるはずなので、ここに来る場合は異常系
      console.error(`書き込み先のシート '${sheetName}' が見つかりません。`);
      throw new Error(`Sheet ${sheetName} not found.`);
    }

    const rows = newArticles.map(article => [
      article.id,
      article.title,
      article.link,
      new Date() // 取得日時
    ]);

    // 最終行+1の位置から、新しいデータをまとめて書き込む
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    console.log(`${rows.length} 件の新着記事をスプレッドシートに書き込みました。`);
  } catch (e) {
    console.error(`スプレッドシートへの書き込み中にエラーが発生しました: ${e.message}`);
    // エラーが起きても処理を止めない場合は、throwしない
  }
}

/**
 * 新着記事を指定された方法で通知します（現在はログ出力のみ）。
 * @param {Array<Object>} newArticles - 通知対象の新着記事リスト。
 */
function sendNotification(newArticles) {
  if (!newArticles || newArticles.length === 0) {
    return;
  }

  // 通知メッセージを作成
  const subject = `RSSフィード新着 ${newArticles.length}件`;
  let body = '新しい記事があります。\n\n';

  for (const article of newArticles) {
    body += `■ ${article.title}\n`;
    body += `${article.link}\n\n`;
  }

  console.log('--- 通知内容プレビュー ---');
  console.log(`件名: ${subject}`);
  console.log(body);
  console.log('-------------------------');

  // TODO: 実際の通知処理をここに実装する
  // 例: Gmailで通知する場合
  // const recipient = 'your-email@example.com';
  // MailApp.sendEmail(recipient, subject, body);
}

function checkRss() {
  // --- 設定項目 ---
  const RSS_URL = 'https://example.com/rss'; // TODO: ここに実際のRSSフィードURLを設定してください
  const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // TODO: ここに実際のスプレッドシートIDを設定してください
  const SHEET_NAME = 'RSS_History'; // 履歴を保存するシート名

  try {
    // 1. 既存の記事IDをスプレッドシートから取得
    const existingIds = getExistingArticleIds(SPREADSHEET_ID, SHEET_NAME);
    console.log(`スプレッドシートから ${existingIds.size} 件の既存IDを読み込みました。`);

    // 2. RSSフィードを取得してXMLとして解析する
    const xmlText = UrlFetchApp.fetch(RSS_URL).getContentText();
    const document = XmlService.parse(xmlText);
    const root = document.getRootElement();

    // RSSのバージョンに応じて名前空間を設定
    const atom = XmlService.getNamespace('http://www.w3.org/2005/Atom');
    const ns = root.getNamespace();

    // 記事(item/entry)のリストを取得
    let items = [];
    if (root.getChild('channel')) {
      items = root.getChild('channel').getChildren('item');
    }
    if (items.length === 0) {
      // Atomフィードの場合
      items = root.getChildren('entry', atom);
    }

    if (items.length === 0) {
      console.log('記事が見つかりませんでした。RSSフィードのURLが正しいか、形式が対応しているか確認してください。');
      return;
    }

    // 3. 記事の情報を抽出する
    const fetchedArticles = [];
    for (const item of items) {
      let title, link, id;
      if (root.getName() === 'feed' && atom.getURI()) { // Atom
        title = item.getChild('title', atom).getText();
        link = item.getChild('link', atom).getAttribute('href').getValue();
        id = item.getChild('id', atom).getText();
      } else { // RSS 2.0 etc.
        title = item.getChild('title', ns) ? item.getChild('title', ns).getText() : 'タイトルなし';
        link = item.getChild('link', ns) ? item.getChild('link', ns).getText() : '';
        // guidがなければlinkをidとして使う
        const guid = item.getChild('guid', ns);
        id = guid ? guid.getText() : link;
      }
      fetchedArticles.push({ title, link, id });
    }
    console.log(`RSSフィードから ${fetchedArticles.length} 件の記事を解析しました。`);

    // 4. 新着記事を判定
    const newArticles = fetchedArticles.filter(article => !existingIds.has(article.id));

    if (newArticles.length === 0) {
      console.log('新着記事はありませんでした。');
      return;
    }

    console.log(`新着記事が ${newArticles.length} 件見つかりました！`);
    // 5. 新着記事をスプレッドシートに書き込む
    appendNewArticlesToSheet(SPREADSHEET_ID, SHEET_NAME, newArticles);

    // 6. 新着記事を通知する
    sendNotification(newArticles);

  } catch (e) {
    console.error(`エラーが発生しました: ${e}`);
    // TODO: エラー通知処理
  }
}
