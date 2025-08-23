# -*- coding: utf-8 -*-
"""
Main entry point for the RSS to Notion AI Tagger system.
Orchestrates the fetching, tagging, summarization, and saving of RSS articles.
"""
import time
from datetime import datetime, timezone
from langdetect import detect, LangDetectException

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, RSS_FEEDS, API_DELAY_SECONDS
from rss_fetcher import fetch_articles_from_feed
from notion_handler import NotionClient
from ai_tagger import AITagger
from ai_summarizer import AISummarizer
from error_logger import ErrorLogger

def run():
    """
    Executes the full RSS-to-Notion pipeline.
    """
    print("🚀 Starting RSS to Notion AI Tagger system...")

    # --- Initialization ---
    if not all([NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY]):
        print("❌ ERROR: Required environment variables are not set.")
        return

    logger = ErrorLogger()

    try:
        notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)
        tagger = AITagger(api_key=GOOGLE_API_KEY, logger=logger)
        summarizer = AISummarizer(api_key=GOOGLE_API_KEY, logger=logger)
    except ValueError as e:
        print(f"❌ ERROR: Failed to initialize clients. Reason: {e}")
        return

    # --- Main Loop ---
    for source_name, url in RSS_FEEDS.items():
        print(f"\n📡 Processing feed: {source_name}")
        articles = fetch_articles_from_feed(url)

        for entry in reversed(articles):
            title = entry.get("title", "No Title")
            link = entry.get("link")

            if not link:
                print(f"    - ⏭️  Skip (no link): {title}")
                continue

            if notion.check_if_url_exists(link):
                print(f"    - ⏭️  Skip (already exists): {title}")
                continue

            summary_text = entry.get("summary", "")

            # Detect language for summarization logic
            try:
                lang = detect(title + " " + summary_text)
            except LangDetectException:
                lang = "unknown"
                print(f"    - ⚠️ Could not detect language for: {title}")

            # Prepare data for AI processing
            article_data_for_ai = {"title": title, "summary": summary_text, "link": link}

            # Generate tags
            tags = tagger.generate_tags(article_data_for_ai)

            # Generate Japanese summary for non-Japanese articles
            jp_summary = None
            if lang != 'ja':
                jp_summary = summarizer.summarize(link, lang)

            # Prepare data for Notion
            published_time = datetime.now(timezone.utc)
            if hasattr(entry, "published_parsed") and entry.published_parsed is not None:
                published_time = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)

            page_data_for_notion = {
                "title": title,
                "url": link,
                "source": source_name,
                "author": entry.get("author", "Unknown"),
                "published_time": published_time,
                "tags": tags,
                "summary": jp_summary # Add summary to the payload
            }

            notion.create_page(page_data_for_notion)

            print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds...")
            time.sleep(API_DELAY_SECONDS)

    print("\n✅ System finished successfully.")


if __name__ == "__main__":
    run()
