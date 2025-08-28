import os
import json

DATA_DIR = "data"
OUTPUT_FILE = os.path.join(DATA_DIR, "consolidated_sources.json")

def consolidate_sources():
    all_sources = {}

    # dataフォルダのテキストファイルを走査
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".txt"):
            filepath = os.path.join(DATA_DIR, filename)
            with open(filepath, "r", encoding="utf-8") as f:
                urls = [line.strip() for line in f if line.strip()]

            # ファイルごとに分類
            all_sources[filename] = urls

    # JSONファイルに書き出し
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_sources, f, ensure_ascii=False, indent=2)

    print(f"✅ Consolidated {len(all_sources)} files into {OUTPUT_FILE}")

if __name__ == "__main__":
    consolidate_sources()
