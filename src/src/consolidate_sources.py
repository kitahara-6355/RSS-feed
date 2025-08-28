import json
import os
from pathlib import Path

DATA_DIR = Path("data")
OUTPUT_FILE = DATA_DIR / "consolidated_sources.json"

def load_sources():
    """Load all text files in data/ and merge them into a single list."""
    sources = []
    for file in DATA_DIR.glob("*.txt"):
        with open(file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
            sources.extend(lines)
    return sorted(set(sources))

def save_sources(sources):
    """Save merged sources into consolidated_sources.json."""
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sources, f, indent=2, ensure_ascii=False)

def main():
    print("Loading sources from data/...")
    sources = load_sources()
    print(f"Loaded {len(sources)} unique sources.")
    save_sources(sources)
    print(f"Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
