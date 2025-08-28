import os
import json
import feedparser
import requests
from datetime import datetime

OUTPUT_FILE = "data/articles.json"

def fetch_articles():
    # RSSソース一覧を読み込み
    with open("data/consolidated_sources.json", "r") as f:
        sources = json.load(f)

    articles = []
    for source in sources:
        rss_url = source.get("rss")
        if not rss_url:
            continue

        print(f"Fetching from {rss_url} ...")
        feed = feedparser.parse(rss_url)

        for entry in feed.entries[:20]:  # 最新20件に制限
            article = {
                "title": entry.title,
                "link": entry.link,
                "published": getattr(entry, "published", None),
                "summary": getattr(entry, "summary", ""),
                "source": rss_url,
                "retrieved_at": datetime.utcnow().isoformat()
            }
            articles.append(article)

    # 既存ファイルとマージ
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "r") as f:
            existing = json.load(f)
    else:
        existing = []

    all_articles = existing + articles

    # 保存
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_articles, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(articles)} new articles. Total: {len(all_articles)}")

if __name__ == "__main__":
    fetch_articles()
