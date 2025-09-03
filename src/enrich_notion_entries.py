# -*- coding: utf-8 -*-
"""
This script finds Notion database entries that were manually added (i.e., have a URL
but no tags) and enriches them with AI-generated tags, a summary, author, and source.
"""
import time
from urllib.parse import urlparse

# Import custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, API_DELAY_SECONDS
from notion_handler import NotionClient
from ai_tagger import AITagger
from ai_summarizer import AISummarizer
from error_logger import ErrorLogger

def get_source_from_url(url: str) -> str:
    """Extracts a clean source name (domain) from a URL."""
    if not url:
        return "Unknown"
    try:
        netloc = urlparse(url).netloc
        # Remove 'www.' and return the domain
        return netloc.replace('www.', '')
    except Exception:
        return "Unknown"

def run_enrichment():
    """
    Executes the full pipeline to find and enrich Notion pages.
    """
    print("🚀 Starting Notion Entry Enrichment Process...")

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

    # 1. Find pages with a URL but no tags
    pages_to_enrich = notion.query_pages_to_enrich()

    if not pages_to_enrich:
        print("✅ No pages to enrich. System finished.")
        return

    for page in pages_to_enrich:
        page_id = page["id"]
        properties = page.get("properties", {})
        title_prop = properties.get("Title", {}).get("title", [])
        title = title_prop[0].get("text", {}).get("content", "No Title") if title_prop else "No Title"
        url_prop = properties.get("URL", {})
        url = url_prop.get("url")

        print(f"\n🔄 Processing page: {title}")

        if not url:
            print(f"    - ⏭️  Skip (no URL): {title}")
            continue

        # 2. Fetch article content and generate data
        # Use the summarizer's scrape method to get content for the tagger
        article_content = summarizer._scrape_article_text(url)
        if not article_content:
            print(f"    - ⏭️  Skip (could not fetch content): {title}")
            continue
        
        article_data_for_ai = {"title": title, "summary": article_content[:1000], "link": url}

        # 3. Generate AI Tags, Author, and Summary
        tags = tagger.generate_tags(article_data_for_ai)
        author = tagger.guess_author(article_data_for_ai)
        jp_summary = summarizer.summarize(url) # Re-summarize for a clean version
        source = get_source_from_url(url)

        # 4. Prepare properties for Notion update
        update_payload = {
            "Tags": {"multi_select": [{"name": tag} for tag in tags]},
            "Author": {"rich_text": [{"text": {"content": author}}]},
            "Source": {"multi_select": [{"name": source}]}
        }
        if jp_summary:
            update_payload["日本語要約"] = {"rich_text": [{"text": {"content": jp_summary}}]}

        # 5. Update the Notion page
        print(f"    - Updating Notion page with generated data...")
        notion.update_page_properties(page_id, update_payload)

        print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds...")
        time.sleep(API_DELAY_SECONDS)

    print("\n✅ Enrichment process finished successfully.")

if __name__ == "__main__":
    run_enrichment()
