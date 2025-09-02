# -*- coding: utf-8 -*-
"""
Main entry point for the RSS to Notion AI Tagger system.
Orchestrates the fetching, tagging, and saving of RSS articles, with
intelligent filtering based on a learned user profile.
"""
import time
import json
from datetime import datetime, timezone

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, RSS_FEEDS, API_DELAY_SECONDS, FILTERING_THRESHOLD
from rss_fetcher import fetch_articles_from_feed
from notion_handler import NotionClient
from ai_tagger import AITagger
from ai_summarizer import AISummarizer
from error_logger import ErrorLogger

def load_user_profile(filepath: str = "user_profile.json") -> dict:
    """Loads the user interest profile from a JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            profile = json.load(f)
            print("🧠 User interest profile loaded successfully.")
            return profile
    except FileNotFoundError:
        print("ℹ️ User profile not found. Running without personalized filtering.)
        return {"tags": {}, "sources": {}}
    except json.JSONDecodeError:
        print("⚠️ WARN: Could not decode user profile. File might be corrupt.)
        return {"tags": {}, "sources": {}}

def calculate_relevance_score(tags: list, source: str, profile: dict) -> float:
    """Calculates a relevance score for an article based on the user profile."""
    if not profile or not (profile.get("tags") or profile.get("sources")):
        return 999.0 # If no profile, treat all articles as relevant

    tag_scores = [profile.get("tags", {}).get(tag, 0) for tag in tags]
    source_score = profile.get("sources", {}).get(source, 0)

    # Use the highest score found among the article's tags and source
    # Default to 0 if no scores are found.
    all_scores = tag_scores + [source_score]
    max_score = max(all_scores) if all_scores else 0

    return max_score

def run():
    """Executes the full RSS-to-Notion pipeline."""
    print("🚀 Starting RSS to Notion AI Tagger system...")

    if not all([NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY]):
        print("❌ ERROR: Required environment variables are not set.")
        return

    logger = ErrorLogger()
    user_profile = load_user_profile()

    try:
        notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)
        tagger = AITagger(api_key=GOOGLE_API_KEY, logger=logger)
        summarizer = AISummarizer(api_key=GOOGLE_API_KEY, logger=logger)
    except ValueError as e:
        print(f"❌ ERROR: Failed to initialize clients. Reason: {e}")
        return

    for source_name, url in RSS_FEEDS.items():
        print(f"\n📡 Processing feed: {source_name}")
        articles = fetch_articles_from_feed(url)

        for entry in reversed(articles):
            link = entry.get("link")
            title = entry.get("title", "No Title")

            if not link or notion.check_if_url_exists(link):
                status = "no link" if not link else "already exists"
                print(f"    - ⏭️  Skip {status}): {title}")
                continue

            article_data_for_ai = {"title": title, "summary": entry.get("summary", ""), "link": link}
            tags = tagger.generate_tags(article_data_for_ai)

            # --- Scoring and Filtering ---
            relevance_score = calculate_relevance_score(tags, source_name, user_profile)
            print(f"    - Relevance Score: {relevance_score:.2f}")
            if relevance_score < FILTERING_THRESHOLD:
                print(f"    - 🗑️  Skipping (low score){title}")
                continue # Skip to the next article

            jp_summary = summarizer.summarize(link)

            published_time = datetime.now(timezone.utc)
            if hasattr(entry, "published_parsed") and entry.published_parsed is not None:
                published_time = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)

            author = entry.get("author", "Unknown")
            if author == "Unknown":
                author = tagger.guess_author(article_data_for_ai)

            page_data_for_notion = {
                "title": title, "url": link, "source": source_name,
                "author": author,
                "published_time": published_time,
                "tags": tags, # Pass clean list of strings
                "summary": jp_summary
            }

            notion.create_page(page_data_for_notion)

            print(f"    - ⏱️ Waiting for{API_DELAY_SECONDS} seconds...")
            time.sleep(API_DELAY_SECONDS)

    print("\n✅ System finished successfully.")

if __name__ == "__main__":
    run()
