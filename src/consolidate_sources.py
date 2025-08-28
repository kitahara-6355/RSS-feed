# src/consolidate_sources.py
import os
import json
import codecs

DATA_DIR = os.path.join(os.path.dirname(__file__), '../data')
OUTPUT_FILE = os.path.join(DATA_DIR, 'consolidated_sources.json')

def consolidate_sources():
    all_urls = set()  # 重複排除のためセットを使用

    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.txt'):
            file_path = os.path.join(DATA_DIR, filename)
            try:
                # UTF-8 BOM対応
                with codecs.open(file_path, 'r', encoding='utf-8-sig') as f:
                    urls = [line.strip() for line in f if line.strip()]
                    all_urls.update(urls)
            except UnicodeDecodeError:
                print(f"Error reading {filename}. Please check its encoding.")

    # JSONとして保存
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_f:
        json.dump(sorted(all_urls), out_f, ensure_ascii=False, indent=2)

    print(f"Consolidated {len(all_urls)} unique URLs into {OUTPUT_FILE}")

if __name__ == "__main__":
    consolidate_sources()
