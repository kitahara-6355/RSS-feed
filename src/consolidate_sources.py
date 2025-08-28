import json

def consolidate_sources():
    try:
        with open("data/consolidated_sources.json", "r", encoding="utf-8") as f:
            sources = json.load(f)
    except FileNotFoundError:
        sources = {"sources": []}

    print("Sources loaded:", sources)
    return sources

if __name__ == "__main__":
    consolidate_sources()
