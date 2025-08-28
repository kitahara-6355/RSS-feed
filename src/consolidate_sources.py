# src/consolidate_sources.py
import os
import json
import glob

def consolidate_sources():
    data_dir = "data"
    output_file = os.path.join(data_dir, "consolidated_sources.json")
    
    consolidated = []

    # dataフォルダ内の全txtファイルを取得
    txt_files = glob.glob(os.path.join(data_dir, "*.txt"))

    for file_path in txt_files:
        try:
            # UTF-8 BOM対応で読み込み
            with open(file_path, "r", encoding="utf-8-sig") as f:
                urls = [line.strip() for line in f if line.strip()]
                for url in urls:
                    consolidated.append({
                        "source_file": os.path.basename(file_path),
                        "url": url
                    })
        except Exception as e:
            log_file = os.path.join(data_dir, "logs", "consolidate_sources.log")
            os.makedirs(os.path.dirname(log_file), exist_ok=True)
            with open(log_file, "a", encoding="utf-8") as log_f:
                log_f.write(f"Error reading {file_path}: {str(e)}\n")
            print(f"Error reading {file_path}: {e}")

    # JSONファイルに出力
    try:
        with open(output_file, "w", encoding="utf-8") as out_f:
            json.dump(consolidated, out_f, indent=2, ensure_ascii=False)
        print(f"Successfully consolidated {len(consolidated)} URLs into {output_file}")
    except Exception as e:
        log_file = os.path.join(data_dir, "logs", "consolidate_sources.log")
        os.makedirs(os.path.dirname(log_file), exist_ok=True)
        with open(log_file, "a", encoding="utf-8") as log_f:
            log_f.write(f"Error writing {output_file}: {str(e)}\n")
        print(f"Error writing {output_file}: {e}")

if __name__ == "__main__":
    consolidate_sources()
