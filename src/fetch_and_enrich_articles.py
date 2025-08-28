import json
import requests
from datetime import datetime

def fetch_and_enrich():
    with open("data/consolidated_sources.json", "r", encoding="utf-8") as f:
        sources = json.load(f)

    articles = []
    for url in sources.get("sources", []):
        # 実際はRSSパースとAIタグ付けを行う
        articles.append({
            "url": url,
            "title": f"Sample title from {url}",
            "fetched_at": datetime.now().isoformat()
        })

    with open("data/articles.json", "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)
    print("Articles saved.")

if __name__ == "__main__":
    fetch_and_enrich()
