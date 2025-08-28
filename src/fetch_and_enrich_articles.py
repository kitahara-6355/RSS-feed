import json
import requests
from datetime import datetime
from pathlib import Path

# 保存先ファイル
ARTICLES_FILE = Path("data/articles.json")
SOURCES_FILE = Path("data/consolidated_sources.json")

def fetch_articles_from_rss(rss_url):
    """
    RSSフィードから記事を取得するダミー関数
    実際には feedparser などを使用して解析可能
    """
    # 今回はテスト用にダミー記事を返す
    return [{
        "title": f"Sample Article from {rss_url}",
        "url": rss_url + "/sample-article",
        "author": "Sample Author",
        "source": rss_url,
        "publication_date": datetime.now().isoformat(),
        "tags": [],
        "summary": "",
    }]

def enrich_article(article):
    """
    記事のAIタグ付けや日本語要約などの加工処理
    ここではテスト用にダミーで設定
    """
    article["tags"] = ["test-tag"]
    article["summary"] = f"Summary for {article['title']}"
    return article

def main():
    # consolidated_sources.jsonを読み込む
    with open(SOURCES_FILE, "r", encoding="utf-8") as f:
        sources = json.load(f)

    all_articles = []

    # sources["sources"] に従ってループ
    for url in sources["sources"]:
        print(f"Fetching articles from {url}")
        articles = fetch_articles_from_rss(url)
        for article in articles:
            enriched = enrich_article(article)
            all_articles.append(enriched)

    # 既存 articles.json があれば読み込み
    if ARTICLES_FILE.exists():
        with open(ARTICLES_FILE, "r", encoding="utf-8") as f:
            existing_articles = json.load(f)
    else:
        existing_articles = []

    # 重複チェック (URL単位)
    existing_urls = {a["url"] for a in existing_articles}
    new_articles = [a for a in all_articles if a["url"] not in existing_urls]

    # 既存記事とマージして保存
    merged_articles = existing_articles + new_articles
    with open(ARTICLES_FILE, "w", encoding="utf-8") as f:
        json.dump(merged_articles, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(new_articles)} new articles. Total: {len(merged_articles)}")

if __name__ == "__main__":
    main()
