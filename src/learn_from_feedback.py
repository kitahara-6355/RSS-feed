# -*- coding: utf-8 -*-
"""
Script to learn from user feedback in the Notion database.

This script analyzes user ratings ('興味度', '重要度') and status for articles,
calculates preference scores for tags and sources, and saves the resulting
user profile to a JSON file.
"""
import json
from collections import defaultdict

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID
from notion_handler import NotionClient
from error_logger import ErrorLogger

def learn_and_save_profile():
    """
    Analyzes all rated pages in Notion and saves a user interest profile.
    """
    print("🚀 Starting feedback learning process...")

    # --- Initialization ---
    if not all([NOTION_TOKEN, NOTION_DATABASE_ID]):
        print("❌ ERROR: NOTION_TOKEN and NOTION_DATABASE_ID must be set.")
        return

    logger = ErrorLogger(log_dir="logs/learning")
    notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)

    # --- Data Fetching ---
    pages = notion.get_all_rated_pages()
    if not pages:
        print("✅ No rated pages found to learn from. Exiting.")
        return

    # --- Profile Calculation ---
    # Use defaultdict to easily handle sums and counts
    tag_scores = defaultdict(lambda: {'total_score': 0, 'count': 0})
    source_scores = defaultdict(lambda: {'total_score': 0, 'count': 0})

    print(f"🧠 Analyzing feedback from {len(pages)} pages...")
    for page in pages:
        properties = page.get("properties", {})

        interest = properties.get("興味度", {}).get("number", 0) or 0
        importance = properties.get("重要度", {}).get("number", 0) or 0
        status = properties.get("Status", {}).get("status", {}).get("name", "")

        # Calculate a simple engagement score
        # 'あとで読む' or '完了' gives a bonus, indicating higher engagement.
        status_bonus = 1 if status in ["あとで読む", "完了"] else 0
        engagement_score = (interest * 0.6) + (importance * 0.4) + status_bonus

        # Don't learn from pages that have a score of 0
        if engagement_score <= 0:
            continue

        # Aggregate scores for tags
        tags = properties.get("Tags", {}).get("multi_select", [])
        for tag in tags:
            tag_name = tag.get("name")
            if tag_name:
                tag_scores[tag_name]['total_score'] += engagement_score
                tag_scores[tag_name]['count'] += 1

        # Aggregate scores for sources
        sources = properties.get("Source", {}).get("multi_select", [])
        for source in sources:
            source_name = source.get("name")
            if source_name:
                source_scores[source_name]['total_score'] += engagement_score
                source_scores[source_name]['count'] += 1

    # --- Final Profile Generation ---
    # Calculate average scores to normalize the data
    final_profile = {
        "tags": {
            tag: data['total_score'] / data['count']
            for tag, data in tag_scores.items()
        },
        "sources": {
            source: data['total_score'] / data['count']
            for source, data in source_scores.items()
        },
        "last_updated": datetime.now().isoformat()
    }

    # --- Save Profile to File ---
    profile_path = "user_profile.json"
    try:
        with open(profile_path, 'w', encoding='utf-8') as f:
            json.dump(final_profile, f, ensure_ascii=False, indent=4)
        print(f"✅ User interest profile successfully saved to {profile_path}")
    except Exception as e:
        print(f"❌ ERROR: Failed to save user profile. Reason: {e}")

    print("\n✅ Learning process finished.")


if __name__ == "__main__":
    learn_and_save_profile()
