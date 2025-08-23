# -*- coding: utf-8 -*-
"""
Script to calculate and update the 'Priority Score' for Notion database entries.

This script queries for pages with '興味度' (Interest) or '重要度' (Importance)
ratings, calculates a weighted priority score, and updates the
'優先度スコア' property for that page.
"""
import time

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, API_DELAY_SECONDS
from notion_handler import NotionClient
from error_logger import ErrorLogger

def calculate_and_update_scores():
    """
    Executes the full score calculation and update pipeline.
    """
    print("🚀 Starting Priority Score Calculation system...")

    # --- Initialization ---
    if not all([NOTION_TOKEN, NOTION_DATABASE_ID]):
        print("❌ ERROR: NOTION_TOKEN and NOTION_DATABASE_ID must be set.")
        return

    logger = ErrorLogger(log_dir="logs/scoring")

    try:
        notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)
    except ValueError as e:
        print(f"❌ ERROR: Failed to initialize Notion client. Reason: {e}")
        return

    # --- Main Loop ---
    # 1. Find pages that have ratings
    pages_to_score = notion.query_pages_for_scoring()

    if not pages_to_score:
        print("✅ No pages found with new ratings to score. All set!")
        return

    for page in pages_to_score:
        page_id = page.get("id")
        properties = page.get("properties", {})

        title_property = properties.get("Title", {}).get("title", [{}])
        title = title_property[0].get("text", {}).get("content", "Page " + page_id) if title_property else "Page " + page_id

        print(f"\n🔄 Processing page: {title}")

        # 2. Get ratings, default to 0 if not present
        interest = properties.get("興味度", {}).get("number", 0) or 0
        importance = properties.get("重要度", {}).get("number", 0) or 0

        # 3. Calculate score
        # The user can adjust the weights in this formula if desired.
        priority_score = (interest * 0.6) + (importance * 0.4)

        # 4. Update the Notion page with the new score
        notion.update_page_score(page_id, priority_score)

        # Respect API rate limits
        print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds...")
        time.sleep(API_DELAY_SECONDS)

    print("\n✅ Score calculation process finished successfully.")


if __name__ == "__main__":
    calculate_and_update_scores()
