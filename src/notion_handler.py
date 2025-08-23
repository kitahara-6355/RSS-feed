# -*- coding: utf-8 -*-
"""
Module for interacting with the Notion API.
This file was renamed from notion_client.py to avoid circular import errors.
"""
from notion_client import Client
from typing import List, Dict, Any

class NotionClient:
    """A wrapper for the Notion API client to handle database operations."""
    def __init__(self, token: str, database_id: str, logger=None):
        if not token or not database_id:
            raise ValueError("Notion token and database ID must be provided.")
        self.notion = Client(auth=token)
        self.database_id = database_id
        self.logger = logger

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
            if self.logger:
                log_data = {"link": url}
                self.logger.log_failure(component="Notion_Client_Check", article_data=log_data, error=e)
            return True

    def create_page(self, article_data: Dict[str, Any]) -> None:
        """
        Creates a new page in the configured Notion database.
        This version uses the corrected schema based on user feedback.
        """
        title = article_data.get("title", "No Title")

        # This payload matches the schema debugged with the user:
        # - "Publication Date" for the date property.
        # - "status" type for the Status property.
        # - "multi_select" for the Source property.
        properties = {
            "Title": {"title": [{"text": {"content": title}}]},
            "URL": {"url": article_data.get("url")},
            "Status": {"status": {"name": "未読"}},
            "Source": {"multi_select": [{"name": article_data.get("source")}]},
            "Author": {"rich_text": [{"text": {"content": article_data.get("author")}}]},
            "Publication Date": {"date": {"start": article_data.get("published_time").isoformat()}},
            "Tags": {"multi_select": [{"name": tag} for tag in article_data.get("tags", [])]}
        }

        summary = article_data.get("summary")
        if summary:
            properties["日本語要約"] = {"rich_text": [{"text": {"content": summary}}]}

        try:
            self.notion.pages.create(
                parent={"database_id": self.database_id},
                properties=properties
            )
            print(f"    - ✅ Added to Notion: {title}")
        except Exception as e:
            print(f"    - ❌ Failed to add to Notion: {title}")
            if self.logger:
                self.logger.log_failure(component="Notion_Client_Create", article_data=article_data, error=e)

    def query_pages_to_enrich(self) -> List[Dict[str, Any]]:
        """Queries for pages that need enrichment (e.g., Tags property is empty)."""
        print("🔎 Querying for Notion pages with empty tags...")
        try:
            response = self.notion.databases.query(
                database_id=self.database_id,
                filter={"property": "Tags", "multi_select": {"is_empty": True}},
            )
            results = response.get("results", [])
            print(f"  - Found {len(results)} pages to enrich.")
            return results
        except Exception as e:
            print(f"    - ❌ ERROR querying for pages to enrich: {e}")
            if self.logger:
                self.logger.log_failure(component="Notion_Client_Query", article_data={}, error=e)
            return []

    def update_page_tags(self, page_id: str, tags: List[str]):
        """Updates the 'Tags' property of a specific page."""
        print(f"    - Updating page {page_id} with tags: {tags}")
        try:
            properties_to_update = {
                "Tags": {"multi_select": [{"name": tag} for tag in tags]}
            }
            self.notion.pages.update(page_id=page_id, properties=properties_to_update)
            print(f"    - ✅ Successfully updated page: {page_id}")
        except Exception as e:
            print(f"    - ❌ Failed to update page {page_id}: {e}")
            if self.logger:
                log_data = {"page_id": page_id, "tags": tags}
                self.logger.log_failure(component="Notion_Client_Update", article_data=log_data, error=e)

    def query_pages_for_scoring(self) -> List[Dict[str, Any]]:
        """Queries for pages that have ratings set."""
        print("🔎 Querying for Notion pages with ratings...")
        try:
            response = self.notion.databases.query(
                database_id=self.database_id,
                filter={
                    "or": [
                        {"property": "興味度", "number": {"is_not_empty": True}},
                        {"property": "重要度", "number": {"is_not_empty": True}}
                    ]
                }
            )
            results = response.get("results", [])
            print(f"  - Found {len(results)} pages with ratings.")
            return results
        except Exception as e:
            print(f"    - ❌ ERROR querying for pages to score: {e}")
            if self.logger:
                self.logger.log_failure(component="Notion_Client_Query_Score", article_data={}, error=e)
            return []

    def update_page_score(self, page_id: str, score: float):
        """Updates the '優先度スコア' (Number property) of a specific page."""
        print(f"    - Updating page {page_id} with score: {score:.2f}")
        try:
            # Note: This assumes '優先度スコア' is a NUMBER property, not a Formula property,
            # as formula properties cannot be updated via the API.
            properties_to_update = {
                "優先度スコア": {"number": score}
            }
            self.notion.pages.update(page_id=page_id, properties=properties_to_update)
            print(f"    - ✅ Successfully updated score for page: {page_id}")
        except Exception as e:
            print(f"    - ❌ Failed to update score for page {page_id}: {e}")
            if self.logger:
                log_data = {"page_id": page_id, "score": score}
                self.logger.log_failure(component="Notion_Client_Update_Score", article_data=log_data, error=e)
