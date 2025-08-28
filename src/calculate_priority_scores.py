# src/calculate_priority_scores.py
import json
from pathlib import Path

DATA_DIR = Path("data")
ARTICLES_FILE = DATA_DIR / "articles.json"

def calculate_score(article):
    # 簡単なサンプル: 興味度×重要度
    interest = article.get("interest", 3)
    importance = article.get("importance", 3)
    return interest * importance

def main():
    if not ARTICLES_FILE.exists():
        raise FileNotFoundError("articles.json not found")

    with ARTICLES_FILE.open("r", encoding="utf-8") as f:
        articles = json.load(f)

    for article in articles:
        article["priority_score"] = calculate_score(article)

    with ARTICLES_FILE.open("w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
