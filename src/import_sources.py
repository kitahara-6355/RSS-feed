# -*- coding: utf-8 -*-
"""
Parses Pocket HTML exports and directories of YouTube URL lists into a
standardized JSON format. It then calculates the top domains from these sources.
"""
import argparse
import json
import os
import logging
from collections import Counter
from urllib.parse import urlparse
from bs4 import BeautifulSoup

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

def read_lines_with_fallback(path: str) -> list[str]:
    """Tries to read a file with multiple common encodings."""
    encodings = ["utf-8-sig", "utf-16", "cp932", "latin1"]
    for enc in encodings:
        try:
            with open(path, "r", encoding=enc) as f:
                return [line.strip() for line in f if line.strip() and not line.isspace()]
        except Exception:
            continue
    logger.warning(f"Failed to read file with all attempted encodings: {path}")
    return []

def parse_pocket_html(path: str) -> list[dict]:
    """Parses a Pocket HTML export file."""
    if not os.path.exists(path):
        logger.warning(f"Pocket HTML file not found at {path}. Skipping.")
        return []

    logger.info(f"Parsing Pocket HTML: {path}")
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        soup = BeautifulSoup(f, "html.parser")

    items = []
    for a in soup.find_all("a"):
        if url := a.get("href"):
            items.append({
                "title": a.get_text(strip=True),
                "url": url,
                "source": "pocket"
            })
    logger.info(f"Parsed {len(items)} items from Pocket export.")
    return items

def parse_youtube_txt_dir(dir_path: str) -> list[dict]:
    """Parses all .txt files in a directory for YouTube URLs."""
    if not os.path.isdir(dir_path):
        logger.warning(f"YouTube directory not found at {dir_path}. Skipping.")
        return []

    logger.info(f"Parsing YouTube URL files from: {dir_path}")
    all_items = []
    for filename in sorted(os.listdir(dir_path)):
        if filename.endswith(".txt"):
            field_name = os.path.splitext(filename)[0]
            file_path = os.path.join(dir_path, filename)
            urls = read_lines_with_fallback(file_path)
            for url in urls:
                if "youtube.com/watch" in url:
                    all_items.append({
                        "title": None,
                        "url": url,
                        "source": "youtube_list",
                        "field": field_name
                    })
    logger.info(f"Parsed {len(all_items)} items from YouTube lists.")
    return all_items

def enrich_and_save_json(items: list, path: str):
    """Adds a 'domain' key to each item and saves the list to a JSON file."""
    if not items:
        logger.warning("No items to save. Skipping JSON creation.")
        return

    for item in items:
        try:
            item["domain"] = urlparse(item["url"]).netloc
        except Exception:
            item["domain"] = ""

    # Ensure the output directory exists
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    logger.info(f"Saved {len(items)} items to {path}")

def generate_top_domains(items: list, path: str, top_n: int = 20):
    """Calculates and saves the top N most frequent domains."""
    if not items:
        logger.warning("No items to process for domain ranking. Skipping.")
        return

    domain_counts = Counter(item["domain"] for item in items if item.get("domain"))
    top_domains_list = [{"domain": d, "count": c} for d, c in domain_counts.most_common(top_n)]

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(top_domains_list, f, ensure_ascii=False, indent=2)
    logger.info(f"Saved Top {len(top_domains_list)} domains to {path}")

def main():
    """Main function to run the import and processing pipeline."""
    parser = argparse.ArgumentParser(description="Import sources and generate domain stats.")
    parser.add_argument("--pocket", default="data/ril_export.html", help="Path to Pocket HTML export file.")
    parser.add_argument("--youtube_dir", default="data/", help="Path to directory of YouTube URL lists.")
    parser.add_argument("--imported_out", default="data/imported_sources.json", help="Output path for the combined sources.")
    parser.add_argument("--top_domains_out", default="data/top20_domains.json", help="Output path for top domains.")
    parser.add_argument("--top_n", type=int, default=20, help="Number of top domains to calculate.")
    args = parser.parse_args()

    pocket_items = parse_pocket_html(args.pocket)
    youtube_items = parse_youtube_txt_dir(args.youtube_dir)

    all_items = pocket_items + youtube_items

    if not all_items:
        logger.error("No items were imported from any source. Halting execution.")
        return

    enrich_and_save_json(all_items, args.imported_out)
    generate_top_domains(all_items, args.top_domains_out, args.top_n)

if __name__ == "__main__":
    main()
