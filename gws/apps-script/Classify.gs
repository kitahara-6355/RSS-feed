/**
 * Classify.gs — 分類と要約。方式を差し替えられるようにしてある。
 *
 * - キーワード分類（常に実行・費用ゼロ）: 興味キーワード シートの語がタイトル/概要に含まれるかで
 *   タグと関連度を決める。旧版 main.py の calculate_relevance_score と同じ「最大の重み」方式。
 * - 要約方式「Sheets AI」: AI要約 列に =AI() の式を書くだけ。生成は人がシート上で押す（使えるかは個人のプランによる）。
 * - 要約方式「Gemini無料API」: 旧版と同じ無料枠の Gemini API を使う。APIキーはスクリプト
 *   プロパティ GEMINI_API_KEY に置く（ファイルにはしない）。課金設定のないキーだけを使うこと。
 */
var Classify = (function () {
  var SUMMARY_PROMPT = 'この記事の要点を3つ、箇条書き（・）で、日本語150文字以内で要約してください。';

  /** キーワードでタグと関連度を付ける。feedWeight はフィードごとの重み（学習結果）。 */
  function byKeywords(article, keywords, feedWeight) {
    var text = (article.title + ' ' + article.summary).toLowerCase();
    var tags = [];
    var score = feedWeight || 0;
    keywords.forEach(function (k) {
      if (k.keyword && text.indexOf(k.keyword.toLowerCase()) !== -1) {
        if (tags.indexOf(k.tag) === -1) tags.push(k.tag);
        if (k.weight > score) score = k.weight;
      }
    });
    return { tags: tags.slice(0, 5), score: score };
  }

  /** 設定された方式で、AI要約が空の記事を埋める。戻り値は処理件数。 */
  function fillSummaries(settings) {
    var mode = settings['要約方式'];
    var limit = Number(settings['1回のAI処理上限']) || 20;
    if (mode === 'Sheets AI') return fillWithSheetsAi_(limit);
    if (mode === 'Gemini無料API') return fillWithGemini_(limit, settings['Geminiモデル']);
    return 0;
  }

  function fillWithSheetsAi_(limit) {
    var targets = Store.articlesWithoutSummary(limit);
    targets.forEach(function (a) {
      // タイトル(E)〜概要(G)を参照させる。式を置くだけで、生成はシート上の操作で行う。
      Store.writeSummary(a.row, '=AI("' + SUMMARY_PROMPT + '", E' + a.row + ':G' + a.row + ')');
    });
    return targets.length;
  }

  function fillWithGemini_(limit, model) {
    var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');
    var targets = Store.articlesWithoutSummary(limit);
    var done = 0;
    // 1回のリクエストで最大10件まとめて送り、無料枠の回数を節約する。
    for (var i = 0; i < targets.length; i += 10) {
      var batch = targets.slice(i, i + 10);
      var results = geminiBatch_(batch, key, model || 'gemini-2.5-flash-lite');
      batch.forEach(function (a, j) {
        var r = results[j];
        if (!r) return;
        var tags = mergeTags_(a.tags, r.tags);
        Store.writeSummary(a.row, r.summary || '', tags);
        done++;
      });
      if (i + 10 < targets.length) Utilities.sleep(5000);
    }
    return done;
  }

  function geminiBatch_(articles, key, model) {
    var list = articles.map(function (a, i) {
      return '[' + i + '] タイトル: ' + a.title + '\n概要: ' + String(a.summary).slice(0, 500);
    }).join('\n\n');
    var prompt = '次の記事それぞれについて、' + SUMMARY_PROMPT +
      'あわせて内容を表す日本語の短いタグを3つ以内で付けてください。\n' +
      '出力は記事の順番どおりのJSON配列で、各要素は {"summary": "...", "tags": ["..."]} とします。\n\n' + list;
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
      })
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Gemini API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    var body = JSON.parse(res.getContentText());
    var text = body.candidates && body.candidates[0].content.parts[0].text;
    var parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  }

  function mergeTags_(existing, added) {
    var tags = String(existing || '').split(',').map(function (t) { return t.trim(); }).filter(String);
    (added || []).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    return tags.slice(0, 5);
  }

  return {
    byKeywords: byKeywords,
    fillSummaries: fillSummaries
  };
})();
