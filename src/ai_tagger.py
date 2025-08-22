# -*- coding: utf-8 -*-
"""
Module for interacting with a generative AI model to generate tags.
"""
import google.generativeai as genai
from typing import List, Dict, Any
import time

class AITagger:
    """A wrapper for the Gemini AI model to handle tag generation."""
    def __init__(self, api_key: str, logger=None):
        if not api_key:
            raise ValueError("Google API Key must be provided.")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')
        self.logger = logger

    def generate_tags(self, article_data: Dict[str, Any]) -> List[str]:
        """
        Generates a list of relevant tags for a given article's data.
        """
        title = article_data.get("title", "No Title")
        summary = article_data.get("summary", "")
        print(f"    - Generating AI tags for: {title}")

        prompt = f"""
        以下の記事のタイトルと要約から、内容を的確に表すカテゴリタグを5つ以内で生成してください。
        タグは、日本語の簡潔なキーワード（例: AI, 経営, Python, セキュリティ, 書評）にしてください。
        複数のタグを生成する場合は、カンマ（,）で区切って出力してください。
        適切なタグが全く思いつかない場合は、「その他」とだけ出力してください。

        ---
        タイトル: {title}
        要約: {summary[:500]}
        ---

        生成されたタグ:
        """

        try:
            # Using a simple retry mechanism for transient API errors.
            for attempt in range(2): # Try a total of 2 times
                try:
                    response = self.model.generate_content(prompt)
                    tags_text = response.text.strip()
                    if not tags_text:
                        return ["その他"]

                    tags = [tag.strip() for tag in tags_text.split(',') if tag.strip()]
                    print(f"    - ✨ AI tags generated: {', '.join(tags)}")
                    return tags
                except Exception as e:
                    print(f"    - ⚠️ AI generation attempt {attempt + 1} failed: {e}")
                    if attempt < 1:
                        time.sleep(5) # Wait longer before the final retry
                    else:
                        raise e
        except Exception as e:
            print(f"    - ❌ ERROR: Failed to generate AI tags for '{title}'.")
            if self.logger:
                self.logger.log_failure(component="AI_Tagger", article_data=article_data, error=e)
            return ["その他"]
