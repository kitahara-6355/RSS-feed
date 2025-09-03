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
    It finds pages that have a URL but are missing Tags, a Japanese Summary, or an Author,
    then generates the missing information using AI and updates the page.
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

    # 1. Find pages with a URL that are missing Tags, a Japanese Summary, or an Author.
    # This query is expanded from the original, which only looked for empty Tags.
    enrich_filter = {
        "and": [
            {"property": "URL", "url": {"is_not_empty": True}},
            {
                "or": [
                    {"property": "Tags", "multi_select": {"is_empty": True}},
                    {"property": "日本語要約", "rich_text": {"is_empty": True}},
                    {"property": "Author", "rich_text": {"is_empty": True}},
                ]
            }
        ]
    }
    # NOTE: The NotionClient wrapper does not have a generic query method, so we call the underlying client directly.
    # This replaces the more specific `query_pages_to_enrich` to expand the script's functionality.
    response = notion.notion.databases.query(
        database_id=notion.database_id,
        filter=enrich_filter
    )
    pages_to_enrich = response.get("results", [])

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

        # 2. Determine which fields need to be populated and fetch content if necessary
        needs_tags = not properties.get("Tags", {}).get("multi_select")
        needs_summary = not properties.get("日本語要約", {}).get("rich_text")
        needs_author = not properties.get("Author", {}).get("rich_text")

        article_content = None
        if needs_tags or needs_summary or needs_author:
            article_content = summarizer._scrape_article_text(url)
            if not article_content:
                print(f"    - ⏭️  Skip (could not fetch content): {title}")
                continue

        # 3. Prepare data and generate missing information
        update_payload = {}
        article_data_for_ai = {"title": title, "summary": article_content[:1000] if article_content else "", "link": url}

        if needs_tags:
            print("    - Generating AI Tags...")
            tags = tagger.generate_tags(article_data_for_ai)
            if tags:
                update_payload["Tags"] = {"multi_select": [{"name": tag} for tag in tags]}

        if needs_author:
            print("    - Generating AI Author...")
            author = tagger.guess_author(article_data_for_ai)
            if author:
                update_payload["Author"] = {"rich_text": [{"text": {"content": author}}]}}

        if needs_summary:
            print("    - Generating AI Summary (Headline)...")
            jp_summary = summarizer.summarize(url)
            if jp_summary:
                update_payload["日本語要約"] = {"rich_text": [{"text": {"content": jp_summary}}]}}

        # 4. Update the Notion page if there's new data
        if update_payload:
            # Also update the source, similar to the original script's behavior
            source = get_source_from_url(url)
            update_payload["Source"] = {"multi_select": [{"name": source}]}

            print(f"    - Updating Notion page with generated data...")
            notion.update_page_properties(page_id, update_payload)
        else:
            print(f"    - ✅ No updates needed for this page.")

        print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds...")
        time.sleep(API_DELAY_SECONDS)

    print("\n✅ Enrichment process finished successfully.")

if __name__ == "__main__":
    run_enrichment()
