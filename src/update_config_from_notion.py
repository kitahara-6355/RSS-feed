1# -*- coding: utf-8 -*-
"""
Notionの推薦リストデータベースからRSSフィードの追加・削除を読み取り、
config.pyのRSS_FEEDSを更新するスクリプト。
"""
import os
import sys
import re
from pathlib import Path
import pprint

# 'src'ディレクトリをシステムパスに追加
# これにより、'config'や'notion_handler'を直接インポートできる
sys.path.append(str(Path(__file__).parent.parent))

from src.notion_handler import NotionClient
from src.config import NOTION_TOKEN

# --- 定数 ---
# NotionデータベースID (RSSフィード推薦リスト)
RECOMMENDATION_DB_ID = "a1b855d98d1f4785a909ec54fe7753e3"

# Notionデータベースのプロパティ名
PROP_NAME = "Source Domain"
PROP_URL = "Candidate RSS"
PROP_ADD = "追加"
PROP_DELETE = "削除"

CONFIG_PATH = Path(__file__).parent / "config.py"

def get_property_value(page: dict, prop_name: str, prop_type: str):
    """Notionのページオブジェクトからプロパティの値を取得する"""
    prop = page.get("properties", {}).get(prop_name, {})
    if not prop:
        return None

    # prop_typeに応じて適切なキーから値を取得
    if prop_type == "title":
        # 'title' はリスト形式
        if prop.get("title"):
            return prop["title"][0].get("text", {}).get("content")
    elif prop_type == "rich_text":
        # 'rich_text' もリスト形式
        if prop.get("rich_text"):
            return prop["rich_text"][0].get("text", {}).get("content")
    elif prop_type == "url":
        return prop.get("url")
    elif prop_type == "checkbox":
        return prop.get("checkbox")
    return None

def update_rss_feeds_in_config(feeds_to_add: dict, feeds_to_remove: list):
    """config.py内のRSS_FEEDSを更新する"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            content = f.read()

        # 現在のRSS_FEEDS辞書を正規表現で探す
        match = re.search(
            r"RSS_FEEDS\s*=\s*\{.*?\n\}", content, re.DOTALL
        )
        if not match:
            print("❌ ERROR: 'RSS_FEEDS' dictionary not found in config.py.")
            return False

        current_feeds_str = match.group(0)
        
        # execを使って文字列から辞書を安全に評価する
        local_scope = {}
        exec(current_feeds_str, {}, local_scope)
        updated_feeds = local_scope.get('RSS_FEEDS', {})

        # フィードを削除
        for name in feeds_to_remove:
            if name in updated_feeds:
                del updated_feeds[name]
                print(f"  - Removing '{name}' from RSS_FEEDS.")

        # フィードを追加（または更新）
        if feeds_to_add:
            updated_feeds.update(feeds_to_add)
            for name in feeds_to_add:
                print(f"  - Adding/Updating '{name}' in RSS_FEEDS.")

        # 新しい辞書の文字列を作成
        new_feeds_str = "RSS_FEEDS = " + pprint.pformat(updated_feeds, indent=4, width=120)

        # ファイル内容を置換
        new_content = content.replace(current_feeds_str, new_feeds_str)

        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            f.write(new_content)
        
        print("\n✅ Successfully updated config.py.")
        return True

    except Exception as e:
        print(f"❌ ERROR updating config.py: {e}")
        return False


def main():
    """メイン処理"""
    print("🚀 Starting RSS feed update process from Notion...")

    if not NOTION_TOKEN:
        print("❌ ERROR: NOTION_TOKEN is not set.")
        return

    notion = NotionClient(token=NOTION_TOKEN, database_id=RECOMMENDATION_DB_ID)

    # 「追加」または「削除」がチェックされているページをクエリ
    filter_conditions = {
        "or": [
            {"property": PROP_ADD, "checkbox": {"equals": True}},
            {"property": PROP_DELETE, "checkbox": {"equals": True}},
        ]
    }
    pages = notion.query_database(filter_conditions=filter_conditions)

    if not pages:
        print("ℹ️ No feeds to add or remove found in Notion. Exiting.")
        return

    feeds_to_add = {}
    feeds_to_remove = []
    pages_to_uncheck = []

    for page in pages:
        page_id = page["id"]
        name = get_property_value(page, PROP_NAME, "title")
        url = get_property_value(page, PROP_URL, "url")
        is_add_checked = get_property_value(page, PROP_ADD, "checkbox")
        is_delete_checked = get_property_value(page, PROP_DELETE, "checkbox")

        if not name:
            print(f"⚠️ Skipping page {page_id} due to missing name.")
            continue

        if is_add_checked:
            if not url:
                print(f"⚠️ Skipping adding '{name}' due to missing URL.")
                continue
            feeds_to_add[name] = url
            pages_to_uncheck.append(page_id)

        if is_delete_checked:
            feeds_to_remove.append(name)
            if page_id not in pages_to_uncheck:
                pages_to_uncheck.append(page_id)

    if not feeds_to_add and not feeds_to_remove:
        print("ℹ️ No valid feeds to add or remove after processing. Exiting.")
        return

    # config.pyを更新
    if not update_rss_feeds_in_config(feeds_to_add, feeds_to_remove):
        return # 更新に失敗した場合はここで終了

    # Notionのチェックボックスをリセット
    print("\n🔄 Resetting checkboxes in Notion...")
    properties_to_update = {
        PROP_ADD: {"checkbox": False},
        PROP_DELETE: {"checkbox": False},
    }
    
    # notion_handlerに汎用的な更新メソッドがあるか確認
    if hasattr(notion, 'update_page_properties') and callable(getattr(notion, 'update_page_properties')):
        for page_id in pages_to_uncheck:
            try:
                notion.update_page_properties(page_id, properties_to_update)
                print(f"  - Successfully unchecked boxes for page {page_id}")
            except Exception as e:
                print(f"    - ❌ Failed to uncheck boxes for page {page_id}: {e}")
    else:
        print("⚠️  'update_page_properties' method not found in NotionClient.")
        print("   Please update notion_handler.py to include this method.")
        for page_id in pages_to_uncheck:
            print(f"  - TODO: Manually uncheck boxes for page {page_id}")

    print("\n🎉 Process finished.")


if __name__ == "__main__":
    main()
