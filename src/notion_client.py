# -*- coding: utf-8 -*-
"""
Module for interacting with the Notion API.
"""
from notion_client import Client
from typing import List, Dict, Any
from datetime import datetime

class NotionClient:
    """A wrapper for the Notion API client to handle database operations."""
    def __init__(self, token: str, database_id: str):
        if not token or not database_id:
            raise ValueError("Notion token and database ID must be provided.")
        self.notion = Client(auth=token)
        self.database_id = database_id

    def check_if_url_exists(self, url: str) -> bool:
        """Queries the database to see if a page with the given URL already exists."""
        try:
            response = self.notion.databases.query(
                database_id=self.database_id,
                filter={"property": "URL", "url": {"equals": url}},
                page_size=1
            )
            return len(response.get("results")) > 0
        except Exception as e:
            print(f"    - ❌ ERROR checking for existing URL '{url[:50]}...': {e}")
            # To be safe, if we can't check, assume it exists to avoid duplicates.
            return True

    def create_page(self, article_data: Dict[str, Any]) -> None:
        """
        Creates a new page in the configured Notion database.

        Args:
            article_data: A dictionary containing all necessary data for the new page,
                          including title, url, author, source, published_time, and tags.
        """
        title = article_data.get("title", "No Title")

        properties = {
            "Title": {"title": [{"text": {"content": title}}]},
            "URL": {"url": article_data.get("url")},
            "Status": {"status": {"name": "未読"}},
            "Source": {"select": {"name": article_data.get("source")}},
            "Author": {"rich_text": [{"text": {"content": article_data.get("author")}}]},
            "Published": {"date": {"start": article_data.get("published_time").isoformat()}},
            "Tags": {"multi_select": [{"name": tag} for tag in article_data.get("tags", [])]}
        }

        try:
            self.notion.pages.create(
                parent={"database_id": self.database_id},
                properties=properties
            )
            print(f"    - ✅ Added to Notion: {title}")
        except Exception as e:
            print(f"    - ❌ Failed to add to Notion: {title}\n       Reason: {e}")
