import os
import json
import requests

NOTION_API_URL = "https://api.notion.com/v1/pages"
NOTION_VERSION = "2022-06-28"

def push_to_notion(recommendations, notion_token, database_id):
    headers = {
        "Authorization": f"Bearer {notion_token}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
    }

    for url in recommendations:
        data = {
            "parent": {"database_id": database_id},
            "properties": {
                "Name": {"title": [{"text": {"content": url}}]},
                "Source": {"url": url},
            },
        }

        response = requests.post(NOTION_API_URL, headers=headers, data=json.dumps(data))
        if response.status_code == 200:
            print(f"✅ Added: {url}")
        else:
            print(f"⚠️ Failed to add {url}: {response.text}")

def main():
    notion_token = os.getenv("NOTION_TOKEN")
    database_id = os.getenv("NOTION_DATABASE_ID")

    if not notion_token or not database_id:
        print("❌ ERROR: NOTION_TOKEN or NOTION_DATABASE_ID not set in environment variables.")
        return

    consolidated_file = "data/consolidated_sources.json"
    if not os.path.exists(consolidated_file):
        print(f"❌ ERROR: {consolidated_file} does not exist. Run consolidate_sources.py first.")
        return

    with open(consolidated_file, "r", encoding="utf-8") as f:
        recommendations = json.load(f)

    push_to_notion(recommendations, notion_token, database_id)

if __name__ == "__main__":
    main()
