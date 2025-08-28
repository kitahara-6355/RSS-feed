import json
import feedparser
import os

DATA_DIR = "data"
CONSOLIDATED_SOURCES_FILE = os.path.join(DATA_DIR, "consolidated_sources.json")
ARTICLES_FILE = os.path.join(DATA_DIR, "articles.json")

def fetch_and_enrich():
    # consolidated_sources.json を読み込む
    with open(CONSOLIDATED_SOURCES_FILE, "r", encoding="utf-8") as f:
        sources = json.load(f).get("sources", [])
    
    all_articles = []

    for url in sources:
        print(f"Fetching RSS from: {url}")
        feed = feedparser.parse(url)
        entries = feed.entries
        print(f"Found {len(entries)} entries")

        for entry in entries:
            article = {
                "title": entry.get("title", ""),
                "link": entry.get("link", ""),
                "published": entry.get("published", ""),
                "summary": entry.get("summary", "")
            }
            all_articles.append(article)

    # articles.json に保存
    with open(ARTICLES_FILE, "w", encoding="utf-8") as f:
        json.dump(all_articles, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(all_articles)} articles to {ARTICLES_FILE}")

if __name__ == "__main__":
    fetch_and_enrich()
