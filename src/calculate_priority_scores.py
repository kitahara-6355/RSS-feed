import json
from pathlib import Path

# ファイルパス
ARTICLES_FILE = Path("data/articles.json")

def calculate_priority_score(article):
    """
    優先度スコアの計算
    例: 興味度と重要度の平均値をスコアとする
    デフォルト値は 3 と仮定
    """
    interest = article.get("興味度", 3)
    importance = article.get("重要度", 3)
    # スコアは単純に平均
    score = (interest + importance) / 2
    return score

def main():
    if not ARTICLES_FILE.exists():
        print(f"{ARTICLES_FILE} が存在しません。fetch_and_enrich_articles.py を先に実行してください。")
        return

    # articles.json を読み込む
    with open(ARTICLES_FILE, "r", encoding="utf-8") as f:
        articles = json.load(f)

    # 各記事に優先度スコアを計算
    for article in articles:
        article["優先度スコア"] = calculate_priority_score(article)

    # 上書き保存
    with open(ARTICLES_FILE, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

    print(f"Calculated priority scores for {len(articles)} articles.")

if __name__ == "__main__":
    main()
