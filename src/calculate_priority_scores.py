import json

def calculate_priority_scores():
    with open("data/articles.json", "r", encoding="utf-8") as f:
        articles = json.load(f)

    for article in articles:
        # サンプル計算（後で評価を反映）
        article["priority_score"] = 1

    with open("data/articles.json", "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)
    print("Priority scores calculated.")

if __name__ == "__main__":
    calculate_priority_scores()
