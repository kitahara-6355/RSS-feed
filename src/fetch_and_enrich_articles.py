# src/fetch_and_enrich_articles.py
import json
import os
import requests
from datetime import datetime

DATA_DIR = "data"
CONSOLIDATED_FILE = os.path.join(DATA_DIR, "consolidated_sources.json")
ARTICLES_FILE = os.path.join(DATA_DIR, "articles.json")

def fetch_articles_from_rss(url):
    """
    RSSから記事を取得する簡易版
    実運用ではfeedparserなどを使って正確に取得可能
    """
    # ここではテスト用にダミー記事を返す
    return [
        {
            "title": f"Dummy article from {url}",
            "url": url,
            "source": url,
            "author": "Unknown",
            "publication_date": datetime.utcnow().isoformat(),
            "tags": [],
            "summary": ""
        }
    ]

def main():
    # consolidated_sources.json の読み込み
    if not os.path.exists(CONSOLIDATED_FILE):
        print(f"❌ {CONSOLIDATED_FILE} が見つかりません")
        return

    with open(CONSOLIDATED_FILE, "r", encoding="utf-8") as f:
        try:
            sources = json.load(f)  # リスト型を想定
        except json.JSONDecodeError:
            print("❌ JSONの読み込みに失敗しました")
            return

    if not isinstance(sources, list):
        print("❌ consolidated_sources.json はリスト形式である必要があります")
        return

    # 既存 articles.json を読み込む（存在しない場合は空リスト）
    if os.path.exists(ARTICLES_FILE):
        with open(ARTICLES_FILE, "r", encoding="utf-8") as f:
            try:
                articles = json.load(f)
            except json.JSONDecodeError:
                articles = []
    else:
        articles = []

    new_articles_count = 0

    for url in sources:
        fetched = fetch_articles_from_rss(url)
        for article in fetched:
            # 重複チェック
            if any(a["url"] == article["url"] for a in articles):
                continue
            articles.append(article)
            new_articles_count += 1

    # articles.json に保存
    with open(ARTICLES_FILE, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

    print(f"✅ 記事取得完了: {new_articles_count} 件追加")

if __name__ == "__main__":
    main()
