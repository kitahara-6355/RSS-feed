# -*- coding: utf-8 -*-
import os
import feedparser
from notion_client import Client
from datetime import datetime, timezone
import time
from dotenv import load_dotenv

# --- Configuration ---
load_dotenv()

# Notion API secrets
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")

# List of RSS Feeds to process
RSS_FEEDS = {
    "Stratechery": "https://stratechery.passport.online/feed/rss/CSK33gZ915wtJAdPakp4b",
    "note/takahiroanno": "https://note.com/takahiroanno/rss",
    "Qiita": "https://qiita.com/feed"
}

# --- Initialization ---
notion = Client(auth=NOTION_TOKEN)

# --- Keyword-based Tagging Rules ---
TAG_RULES = {
    "AI": ["AI", "人工知能", "machine learning", "深層学習", "LLM", "GPT", "ChatGPT"],
    "Python": ["Python", "Django", "Flask", "FastAPI"],
    "Business": ["経営", "ビジネス", "スタートアップ", "事業", "マーケティング"],
    "Tech": ["テクノロジー", "SaaS", "Web3", "クラウド"],
    "Programming": ["プログラミング", "ソフトウェア", "開発", "コード"],
    "Society": ["社会", "政策", "規制", "法制度", "教育"]
}

# --- Notion Functions ---

def check_if_url_exists(url_to_check: str) -> bool:
    """Queries the Notion database to see if a page with the given URL already exists."""
    try:
        results = notion.databases.query(
            database_id=NOTION_DATABASE_ID,
            filter={"property": "URL", "url": {"equals": url_to_check}},
            page_size=1
        ).get("results")
        return len(results) > 0
    except Exception as e:
        print(f"Error checking for existing URL: {e}")
        return True

def assign_tags(title: str, summary: str) -> list:
    """Assigns tags based on keywords found in the title or summary."""
    tags_to_add = []
    content = f"{title.lower()} {summary.lower()}"
    for tag, keywords in TAG_RULES.items():
        if any(keyword.lower() in content for keyword in keywords):
            tags_to_add.append({"name": tag})
    return tags_to_add

def add_article_to_notion(entry, source_name: str):
    """Creates a new page in the Notion database for a given article."""
    title = entry.get("title", "No Title")
    link = entry.get("link", "")

    if not link:
        return

    if check_if_url_exists(link):
        print(f"⏭️  Skip (already exists): {title}")
        return

    author = entry.get("author", "Unknown")
    tags = assign_tags(title, "") # Summary is often too noisy, just use title for now.

    published_time = datetime.now(timezone.utc)
    if hasattr(entry, "published_parsed") and entry.published_parsed is not None:
        published_time = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)

    # Corrected properties based on user feedback
    properties = {
        "Title": {"title": [{"text": {"content": title}}]},
        "URL": {"url": link},
        "Status": {"multi_select": [{"name": "未読"}]},
        "Source": {"multi_select": [{"name": source_name}]},
        "Author": {"rich_text": [{"text": {"content": author}}]},
        "Publication Date": {"date": {"start": published_time.isoformat()}},
    }
    if tags:
        properties["Tags"] = {"multi_select": tags}

    try:
        notion.pages.create(
            parent={"database_id": NOTION_DATABASE_ID},
            properties=properties
        )
        print(f"✅ Added to Notion: {title}")
    except Exception as e:
        print(f"❌ Failed to add to Notion: {title}\n   Reason: {e}")

# --- Main Execution ---

def main():
    """Fetches RSS feeds and adds new articles to the Notion database."""
    print("--- Starting RSS to Notion Sync ---")
    if not all([NOTION_TOKEN, NOTION_DATABASE_ID]):
        print("Error: NOTION_TOKEN or NOTION_DATABASE_ID environment variables not set.")
        return

    for source_name, url in RSS_FEEDS.items():
        print(f"\n📡 Processing feed: {source_name} ({url})")
        try:
            feed = feedparser.parse(url)
            for entry in reversed(feed.entries):
                add_article_to_notion(entry, source_name)
                time.sleep(0.5)
        except Exception as e:
            print(f"  - Failed to process feed {url}. Reason: {e}")

    print("\n--- Sync Finished ---")

if __name__ == "__main__":
    main()
