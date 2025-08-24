import json
from bs4 import BeautifulSoup
from collections import Counter
from urllib.parse import urlparse

# --- File paths ---
html_path = "data/ril_export.html"
txt_path = "data/youtube_urls.txt"
imported_sources_path = "data/imported_sources.json"
top20_path = "data/top20_domains.json"

def read_lines_with_fallback(path):
    encodings = ["utf-8-sig", "utf-16", "cp932"]
    for enc in encodings:
        try:
            with open(path, "r", encoding=enc) as f:
                return [line.strip() for line in f if line.strip()]
        except Exception:
            continue
    raise ValueError(f"Failed to read file: {path}")

# --- Step 1: Parse ril_export.html ---
with open(html_path, "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f, "html.parser")

pocket_items = []
for a in soup.find_all("a"):
    title = a.get_text(strip=True)
    url = a.get("href")
    if url:
        pocket_items.append({"title": title, "url": url, "source": "pocket"})

# --- Step 2: Parse YouTube txt ---
youtube_urls = read_lines_with_fallback(txt_path)
youtube_items = [{"title": None, "url": url, "source": "youtube_list"} for url in youtube_urls]

# --- Step 3: Merge & Enrich ---
all_items = pocket_items + youtube_items

# Add a 'domain' key to each item for easier processing later
for item in all_items:
    if item.get("url"):
        try:
            item["domain"] = urlparse(item["url"]).netloc
        except Exception:
            item["domain"] = "" # Handle potential parsing errors

with open(imported_sources_path, "w", encoding="utf-8") as f:
    json.dump(all_items, f, ensure_ascii=False, indent=2)

# --- Step 4: Top20 domains ---
domain_counts = Counter(urlparse(item["url"]).netloc for item in all_items if item["url"])
top20 = domain_counts.most_common(20)
top20_domains = [{"domain": d, "count": c} for d, c in top20]

with open(top20_path, "w", encoding="utf-8") as f:
    json.dump(top20_domains, f, ensure_ascii=False, indent=2)

print(f"Saved {len(all_items)} items to {imported_sources_path}")
print(f"Saved Top20 domains to {top20_path}")
