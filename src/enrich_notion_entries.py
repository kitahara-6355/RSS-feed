# -*- coding: utf-8 -*-
"""
This script finds Notion database entries that were manually added (i.e., have a URL
but are missing other metadata) and enriches them using AI.
"""
import time
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup
from typing import Optional

# Import our custom modules
from config import NOTION_TOKEN, NOTION_DATABASE_ID, GOOGLE_API_KEY, API_DELAY_SECONDS
from notion_handler import NotionClient
from ai_tagger import AITagger
from ai_summarizer import AISummarizer
from error_logger import ErrorLogger
from rss_fetcher import get_source_from_url

def _get_page_title(url: str) -> Optional[str]:
    """Scrapes the title from a given URL."""
    print(f"    - Scraping title from: {url[:70]}...")
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        if soup.title and soup.title.string:
            return soup.title.string.strip()
        return None
    except Exception as e:
        print(f"    - ❌ ERROR scraping title from {url}: {e}")
        return None

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

    # Find pages that need enrichment
    pages_to_enrich = notion.query_pages_to_enrich()

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
        
        # If title is missing, fetch it from the URL
        if title == "No Title":
            fetched_title = _get_page_title(url)
            if fetched_title:
                print(f"    - ✨ Fetched title: {fetched_title}")
                update_payload["Title"] = {"title": [{"text": {"content": fetched_title}}]}
                title = fetched_title # Update title for subsequent steps

        # Get the necessary data for AI processing
        source = get_source_from_url(url)
        article_data_for_ai = {"title": title, "link": url}

        # Generate missing information using AI
        if not properties.get("Tags", {}).get("multi_select"):
            tags = tagger.generate_tags(article_data_for_ai)
            if tags:
                update_payload["Tags"] = {"multi_select": [{"name": tag} for tag in tags]}

        if not properties.get("Author", {}).get("rich_text"):
            author = tagger.guess_author(article_data_for_ai)
            if author and author != "Unknown":
                update_payload["Author"] = {"rich_text": [{"text": {"content": author}}] }

        if not properties.get("日本語要約", {}).get("rich_text"):
            jp_summary = summarizer.summarize(url)
            if jp_summary:
                update_payload["日本語要約"] = {"rich_text": [{"text": {"content": jp_summary}}] }
        
        # Update the Notion page if there's new data
        if update_payload:
            # Also update the source and publication date if they are missing
            if not properties.get("Source", {}).get("multi_select") and source:
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
