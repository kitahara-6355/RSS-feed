# -*- coding: utf-8 -*-
"""
Main entry point for the RSS to Notion AI Tagger system.
Orchestrates the fetching, tagging, and saving of RSS articles.
"""
import time
from datetime import datetime, timezone

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, RSS_FEEDS, API_DELAY_SECONDS
from rss_fetcher import fetch_articles_from_feed
from notion_handler import NotionClient
from ai_tagger import AITagger
from error_logger import ErrorLogger

def run():
    """
    Executes the full RSS-to-Notion pipeline.
    """
    print("🚀 Starting RSS to Notion AI Tagger system...")

    # --- Initialization ---
    if not all([NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY]):
        print("❌ ERROR: Required environment variables (NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY) are not set.")
        return

    logger = ErrorLogger()

    try:
        notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)
        tagger = AITagger(api_key=GOOGLE_API_KEY, logger=logger)
    except ValueError as e:
        print(f"❌ ERROR: Failed to initialize clients. Reason: {e}")
        return

    # --- Main Loop ---
    for source_name, url in RSS_FEEDS.items():
        print(f"\n📡 Processing feed: {source_name}")
        articles = fetch_articles_from_feed(url)

        # Process entries in reverse for chronological order in Notion
        for entry in reversed(articles):
            title = entry.get("title", "No Title")
            link = entry.get("link")

            if not link:
                print(f"    - ⏭️  Skip (no link): {title}")
                continue

            # 1. Check for duplicates in Notion
            if notion.check_if_url_exists(link):
                print(f"    - ⏭️  Skip (already exists): {title}")
                continue

            # Prepare data dictionary to pass around
            article_data = {
                "title": title,
                "link": link,
                "summary": entry.get("summary", ""),
                "author": entry.get("author", "Unknown"),
                "source": source_name,
                "published_parsed": entry.get("published_parsed")
            }

            # 2. Generate AI tags
            tags = tagger.generate_tags(article_data)

            # 3. Prepare data for Notion page
            published_time = datetime.now(timezone.utc)
            if article_data.get("published_parsed") is not None:
                published_time = datetime.fromtimestamp(time.mktime(article_data["published_parsed"]), tz=timezone.utc)

            page_data_for_notion = {
                "title": title,
                "url": link,
                "source": source_name,
                "author": article_data.get("author"),
                "published_time": published_time,
                "tags": tags
            }

            # 4. Create Notion page
            notion.create_page(page_data_for_notion)

            # Respect API rate limits
            print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds to respect API rate limits...")
            time.sleep(API_DELAY_SECONDS)

    print("\n✅ System finished successfully.")


if __name__ == "__main__":
    run()
