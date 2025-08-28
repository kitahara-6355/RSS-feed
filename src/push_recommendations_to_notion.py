import os
import json
import requests

NOTION_API_KEY = os.getenv("NOTION_API_KEY")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")

HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

def push_to_notion():
    if not NOTION_API_KEY or not NOTION_DATABASE_ID:
        raise EnvironmentError("❌ Missing NOTION_API_KEY or NOTION_DATABASE_ID environment variables")

    with open("data/consolidated_sources.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    for source_name, urls in data.items():
        for url in urls:
            payload = {
                "parent": {"database_id": NOTION_DATABASE_ID},
                "properties": {
                    "Name": {
                        "title": [{"text": {"content": source_name}}]
                    },
                    "URL": {
                        "url": url
                    }
                }
            }

            response = requests.post("https://api.notion.com/v1/pages", headers=HEADERS, json=payload)

            if response.status_code != 200:
                print(f"⚠️ Failed to push {url}: {response.text}")
            else:
                print(f"✅ Added {url} from {source_name} to Notion")

if __name__ == "__main__":
    push_to_notion()
