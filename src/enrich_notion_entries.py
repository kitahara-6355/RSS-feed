# -*- coding: utf-8 -*-
"""
This script finds Notion database entries that were manually added (i.e., have a URL
but are missing other metadata) and enriches them using AI.
"""
import time
from datetime import datetime, timezone

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, API_DELAY_SECONDS
from notion_handler import NotionClient
from ai_tagger import AITagger
from ai_summarizer import AISummarizer
from error_logger import ErrorLogger
from rss_fetcher import get_source_from_url

def run_enrichment():
    """
    Finds unprocessed pages in Notion and enriches them with AI-generated
    tags, summaries, and guessed authors.
    """
    print("🚀 Starting Notion Entry Enrichment Process...")

    if not all([NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY]):
        print("❌ ERROR: Required environment variables are not set.")
        return

    logger = ErrorLogger(log_dir="logs/enrichment")
    
    try:
        notion = NotionClient(token=NOTION_TOKEN, database_id=NOTION_DATABASE_ID, logger=logger)
        tagger = AITagger(api_key=GOOGLE_API_KEY, logger=logger)
        summarizer = AISummarizer(api_key=GOOGLE_API_KEY, logger=logger)
    except ValueError as e:
        print(f"❌ ERROR: Failed to initialize clients. Reason: {e}")
        return

    # 1. Find pages with a URL that are missing key enrichment data.
    enrich_filter = {
        "and": [
            {"property": "URL", "url": {"is_not_empty": True}},
            {
                "or": [
                    {"property": "Tags", "multi_select": {"is_empty": True}},
                    {"property": "日本語要約", "rich_text": {"is_empty": True}},
                    {"property": "Author", "rich_text": {"is_empty": True}},
                    {"property": "Source", "multi_select": {"is_empty": True}},
                ]
            }
        ]
    }
    
    try:
        response = notion.notion.databases.query(
            database_id=notion.database_id,
            filter=enrich_filter
        )
        pages_to_enrich = response.get("results", [])
    except Exception as e:
        print(f"    - ❌ ERROR querying database: {e}")
        if logger:
            logger.log_failure(component="Enrichment_Query", article_data={"filter": enrich_filter}, error=e)
        pages_to_enrich = []

    if not pages_to_enrich:
        print("✅ No pages to enrich. System finished.")
        return
        
    print(f"ℹ️ Found {len(pages_to_enrich)} pages to enrich.")

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

        update_payload = {}
        
        # 2. Get the necessary data for AI processing
        source = get_source_from_url(url)
        article_data_for_ai = {"title": title, "link": url}
        
        # 3. Generate missing information using AI
        if not properties.get("Tags", {}).get("multi_select"):
            tags = tagger.generate_tags(article_data_for_ai)
            if tags:
                update_payload["Tags"] = {"multi_select": [{"name": tag} for tag in tags]}

        if not properties.get("Author", {}).get("rich_text"):
            author = tagger.guess_author(article_data_for_ai)
            if author and author != "Unknown":
                update_payload["Author"] = {"rich_text": [{"text": {"content": author}}]}

        if not properties.get("日本語要約", {}).get("rich_text"):
            jp_summary = summarizer.summarize(url)
            if jp_summary:
                update_payload["日本語要約"] = {"rich_text": [{"text": {"content": jp_summary}}]}
        
        # 4. Update the Notion page if there's new data
        if update_payload:
            # Also update the source and publication date if they are missing
            if not properties.get("Source", {}).get("multi_select"):
                update_payload["Source"] = {"multi_select": [{"name": source}]}
            
            if not properties.get("Publication Date", {}).get("date"):
                update_payload["Publication Date"] = {"date": {"start": datetime.now(timezone.utc).isoformat()}}
            
            print("    - ⬆️  Updating Notion page with generated data...")
            try:
                notion.notion.pages.update(page_id=page_id, properties=update_payload)
            except Exception as e:
                print(f"    - ❌ Failed to update page {page_id}: {e}")
                if logger:
                    log_data = {"page_id": page_id, "properties": update_payload}
                    logger.log_failure(component="Enrichment_Update", article_data=log_data, error=e)
        else:
            print("    - ✅ No updates needed for this page.")

        print(f"    - ⏱️ Waiting for {API_DELAY_SECONDS} seconds...")
        time.sleep(API_DELAY_SECONDS)
        
    print("\n✅ Enrichment process finished successfully.")

if __name__ == "__main__":
    run_enrichment()
