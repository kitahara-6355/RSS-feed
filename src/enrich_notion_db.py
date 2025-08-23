# -*- coding: utf-8 -*-
"""
Script to enrich existing Notion database entries with AI-generated tags.

This script queries a Notion database for pages where the 'Tags' property
is empty, generates tags for them using a generative AI, and updates the
pages with the new tags.
"""
import time

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, API_DELAY_SECONDS
from notion_handler import NotionClient
from ai_tagger import AITagger
from error_logger import ErrorLogger

def run_enrichment():
    """
    Executes the full enrichment pipeline for existing Notion pages.
    """
    print("🚀 Starting Notion DB Enrichment system...")

    # --- Initialization ---
    if not all([NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY]):
        print("❌ ERROR: Required environment variables are not set.")
        return

    logger = ErrorLogger(log_dir="logs/enrichment")

    try:
        notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)
        tagger = AITagger(api_key=GOOGLE_API_KEY, logger=logger)
    except ValueError as e:
        print(f"❌ ERROR: Failed to initialize clients. Reason: {e}")
        return

    # --- Main Loop ---
    # 1. Find pages that need enrichment
    pages_to_enrich = notion.query_pages_to_enrich()

    if not pages_to_enrich:
        print("✅ No pages found needing enrichment. All set!")
        return

    for page in pages_to_enrich:
        page_id = page.get("id")
        properties = page.get("properties", {})

        # Extract title and handle cases where it might be empty
        title_property = properties.get("Title", {}).get("title", [])
        if not title_property:
            print(f"    - ⏭️  Skipping page {page_id} because it has no title.")
            continue
        title = title_property[0].get("text", {}).get("content", "No Title")

        # In a future version, we could fetch content from the URL for better context
        article_data = {
            "title": title,
            "summary": "", # Summary is not stored in Notion for manual entries
            "link": properties.get("URL", {}).get("url")
        }

        print(f"\n🔄 Processing page: {title}")

        # 2. Generate AI tags
        tags = tagger.generate_tags(article_data)

        # 3. Update the Notion page with the new tags
        if tags and "その他" not in tags:
            notion.update_page_tags(page_id, tags)
        else:
            print("    - ⏭️  Skipping tag update due to no specific tags generated.")

        # Respect API rate limits
        print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds...")
        time.sleep(API_DELAY_SECONDS)

    print("\n✅ Enrichment process finished successfully.")


if __name__ == "__main__":
    run_enrichment()
