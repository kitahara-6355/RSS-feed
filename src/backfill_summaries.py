# src/backfill_summaries.py
import os
import sys
from logging import getLogger, basicConfig, INFO
from tqdm import tqdm

# プロジェクトルートをパスに追加
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.notion_handler import NotionHandler
from src.ai_summarizer import AISummarizer
from src.config import NOTION_DATABASE_ID

# ロギングの設定
basicConfig(level=INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = getLogger(__name__)

def backfill_summaries():
    """
    Notionデータベース内のすべての記事をチェックし、
    日本語要約が古い形式または空の場合に新しい要約を生成して更新する。
    """
    notion_handler = NotionHandler(NOTION_DATABASE_ID)
    summarizer = AISummarizer()

    logger.info("Notionデータベースからすべての記事を取得しています...")
    all_pages = notion_handler.get_all_pages()
    logger.info(f"{len(all_pages)}件の記事を取得しました。")

    # tqdmを使って進捗バーを表示
    for page in tqdm(all_pages, desc="要約のバックフィル処理中"):
        try:
            page_id = page['id']
            properties = page.get('properties', {})
            
            url_property = properties.get('URL', {})
            url = url_property.get('url')

            summary_property = properties.get('日本語要約', {})
            summary_rich_text = summary_property.get('rich_text', [])
            
            current_summary = ""
            if summary_rich_text:
                current_summary = summary_rich_text[0].get('text', {}).get('content', '')

            # 要約が空、または箇条書きで始まっていない場合に処理
            if not current_summary or not current_summary.strip().startswith('・'):
                if not url:
                    logger.warning(f"URLが見つからないため、ページID: {page_id} をスキップします。")
                    continue

                logger.info(f"記事のURL: {url} の要約を更新します。")
                
                # 新しい要約を生成
                new_summary = summarizer.summarize(url)

                if new_summary:
                    # Notionページを更新
                    update_data = {
                        "日本語要約": {
                            "rich_text": [{
                                "text": {
                                    "content": new_summary
                                }
                            }]
                        }
                    }
                    notion_handler.update_page_properties(page_id, update_data)
                    logger.info(f"ページID: {page_id} の要約を更新しました。")
                else:
                    logger.warning(f"URL: {url} の要約生成に失敗しました。")

        except Exception as e:
            logger.error(f"ページID: {page.get('id', 'N/A')} の処理中にエラーが発生しました: {e}")

    logger.info("すべての記事の要約バックフィル処理が完了しました。")

if __name__ == "__main__":
    backfill_summaries()
