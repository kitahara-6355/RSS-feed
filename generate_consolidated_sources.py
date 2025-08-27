import os
import re
import json
from collections import Counter
from urllib.parse import urlparse

DATA_DIR = "data"
OUTPUT_FILE = os.path.join(DATA_DIR, "consolidated_sources.json")

# URL抽出用の正規表現
URL_PATTERN = re.compile(r'https?://[^\s"\'>)]+')

def extract_urls_from_file(filepath):
    urls = []
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
        urls.extend(URL_PATTERN.findall(content))
    return urls

def main():
    all_urls = []

    # data フォルダ内の全ファイルを処理
    for filename in os.listdir(DATA_DIR):
        filepath = os.path.join(DATA_DIR, filename)
        if os.path.isfile(filepath):
            urls = extract_urls_from_file(filepath)
            all_urls.extend(urls)
            print(f"✅ {filename}: {len(urls)} URLs extracted")

    # ドメインごとに集計
    domains = [urlparse(u).netloc for u in all_urls]
    counter = Counter(domains)

    # 出現頻度順に並べる
    sorted_domains = counter.most_common()

    # 分類
    major_sources = [d for d, _ in sorted_domains[:20]]
    medium_sources = [d for d, _ in sorted_domains[20:100]]
    rare_sources = [d for d, _ in sorted_domains[100:]]

    result = {
        "total_urls": len(all_urls),
        "unique_domains": len(counter),
        "major_sources": major_sources,
        "medium_sources": medium_sources,
        "rare_sources": rare_sources
    }

    # JSON 出力
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\n🎉 統合完了: {OUTPUT_FILE}")
    print(f"  - URL総数: {result['total_urls']}")
    print(f"  - ドメイン総数: {result['unique_domains']}")
    print(f"  - Top 20: {len(major_sources)} sources")
    print(f"  - Top 50〜100: {len(medium_sources)} sources")
    print(f"  - Rare: {len(rare_sources)} sources")

if __name__ == "__main__":
    main()
