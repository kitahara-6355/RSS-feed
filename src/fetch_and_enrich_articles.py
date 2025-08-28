# src/fetch_and_enrich_articles.py
import os
import json
import requests
from datetime import datetime
from pathlib import Path

DATA_DIR = Path("data")
ARTICLES_FILE = DATA_DIR / "articles.json"

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

def fetch_article(url):
    # サンプル: 記事を取得してAIで要約・タグ付け
    # 実際はGoogle Gemini AI APIなどを呼び出す
    return {
        "url": url,
        "title": f"Title for {url}",
        "summary": f"Summary generated for {url}",
        "tags": ["tag1", "tag2"],
        "fetched_at": datetime.utcnow().isoformat()
    }

def main():
    DATA_DIR.mkdir(exist_ok=True)
    sources_file = DATA_DIR / "consolidated_sources.json"
    if not sources_file.exists():
        raise FileNotFoundError("consolidated_sources.json not found")

    with sources_file.open("r", encoding="utf-8") as f:
        sources = json.load(f)

    articles = []
    for url in sources.get("urls", []):
        try:
            article = fetch_article(url)
            articles.append(article)
        except Exception as e:
            print(f"Failed to fetch {url}: {e}")

    with ARTICLES_FILE.open("w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
