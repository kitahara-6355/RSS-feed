# -*- coding: utf-8 -*-
"""
Script to recommend new RSS feeds based on user interest profile.
"""
import json
import re
from datetime import datetime

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, RSS_FEEDS
from notion_handler import NotionClient
from error_logger import ErrorLogger

# This is a special import that will be replaced by the real tool at runtime
# For local testing, you would mock this.
from AGI import google_search

def load_user_profile(filepath: str = "user_profile.json") -> dict:
    """Loads the user interest profile from a JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def find_top_tags(profile: dict, count: int = 3) -> list:
    """Finds the top N tags from the user profile based on score."""
    tag_scores = profile.get("tags", {})
    if not tag_scores:
        return []

    # Sort tags by score in descending order and get the top N
    sorted_tags = sorted(tag_scores.items(), key=lambda item: item[1], reverse=True)
    return [tag for tag, score in sorted_tags[:count]]

def search_for_feeds(tag: str) -> list:
    """Uses Google Search to find potential RSS feeds for a given tag."""
    print(f"  - Searching for feeds related to '{tag}'...")
    query = f'"{tag}" blog technical article rss feed'
    try:
        # This uses the special `google_search` tool
        search_results = google_search(query)

        # Simple regex to find potential RSS feed URLs
        # This is a heuristic and may not be perfect.
        url_pattern = r'https?://[^\s"]+\.(?:xml|rss|atom)(?![a-zA-Z0-9])|https?://[^\s"]+/feed/?'
        found_urls = re.findall(url_pattern, search_results)

        # Clean up and deduplicate
        unique_urls = sorted(list(set(url.strip(".,'\"") for url in found_urls)))
        print(f"    - Found {len(unique_urls)} potential URLs for '{tag}'.")
        return unique_urls
    except Exception as e:
        print(f"  - ❌ ERROR during web search for tag '{tag}': {e}")
        return []

def run_recommendation():
    """
    Executes the full feed recommendation pipeline.
    """
    print("🚀 Starting Feed Recommendation system...")

    # --- Initialization ---
    # The suggestions page ID would be loaded from config/secrets in a real implementation
    # For now, we need to add it to config or get it from secrets.
    # Let's assume it will be in a new secret NOTION_SUGGESTIONS_PAGE_ID
    SUGGESTIONS_PAGE_ID = os.getenv("NOTION_SUGGESTIONS_PAGE_ID")
    if not all([NOTION_TOKEN, SUGGESTIONS_PAGE_ID]):
        print("❌ ERROR: NOTION_TOKEN and NOTION_SUGGESTIONS_PAGE_ID must be set.")
        return

    logger = ErrorLogger(log_dir="logs/recommendations")
    notion = NotionClient(token=NOTION_TOKEN, database_id="", logger=logger) # DB ID not needed for page append

    # --- Main Logic ---
    user_profile = load_user_profile()
    if not user_profile:
        print("ℹ️ No user profile found. Cannot generate recommendations. Exiting.")
        return

    top_tags = find_top_tags(user_profile)
    if not top_tags:
        print("ℹ️ No rated tags in profile. Cannot generate recommendations. Exiting.")
        return

    print(f"🧠 Top interest tags: {', '.join(top_tags)}")

    all_suggestions = set()
    for tag in top_tags:
        suggested_urls = search_for_feeds(tag)
        all_suggestions.update(suggested_urls)
        time.sleep(1) # Be nice to the search tool

    # Filter out feeds that are already in the user's list
    existing_feeds = set(RSS_FEEDS.values())
    new_suggestions = [url for url in all_suggestions if url not in existing_feeds]

    if not new_suggestions:
        print("✅ No new feeds to suggest at this time.")
        return

    # --- Append to Notion ---
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = f"\n--- RSS Feed Suggestions ({timestamp}) ---\n"
    suggestions_text = header + "\n".join(new_suggestions)

    notion.append_text_to_page(SUGGESTIONS_PAGE_ID, suggestions_text)

    print("\n✅ Recommendation process finished successfully.")

if __name__ == "__main__":
    run_recommendation()
