# -*- coding: utf-8 -*-
"""
Module for fetching web page content and generating a summary using a generative AI.
"""
import requests
from bs4 import BeautifulSoup
import google.generativeai as genai
from typing import Optional
from langdetect import detect, LangDetectException

class AISummarizer:
    """A wrapper for scraping content and using Gemini to summarize it."""
    def __init__(self, api_key: str, logger=None):
        if not api_key:
            raise ValueError("Google API Key must be provided.")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')
        self.logger = logger

    def _scrape_article_text(self, url: str) -> Optional[str]:
        """Scrapes the main text content from a given URL."""
        print(f"    - Scraping content from: {url[:70]}...")
        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'}
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')

            main_content = soup.find('article') or soup.find('main') or soup.body

            if main_content:
                text = ' '.join(p.get_text() for p in main_content.find_all('p'))
                return ' '.join(text.split())
            return None
        except Exception as e:
            print(f"    - ❌ ERROR scraping {url}: {e}")
            if self.logger:
                self.logger.log_failure("Summarizer_Scrape", {"link": url}, e)
            return None

    def summarize(self, url: str) -> Optional[str]:
        """
        Generates a Japanese summary for a given article URL.
        It detects the language and adjusts the prompt accordingly.
        """
        content = self._scrape_article_text(url)
        if not content:
            return None

        try:
            lang = detect(content)
        except LangDetectException:
            lang = "unknown" # Default if language detection fails

        print(f"    - Generating Japanese summary for: {url[:70]}... (Detected language: {lang})")

        if lang == 'ja':
            prompt_template = "以下の記事本文を、内容の要点を3〜5文程度の、自然で分かりやすい日本語で要約してください。"
        else:
            prompt_template = "以下の英語の記事本文を、内容の要点を3〜5文程度の、自然で分かりやすい日本語で要約してください。"

        prompt = f"""
        {prompt_template}

        ---
        記事本文:
        {content[:3000]}
        ---

        日本語の要約:
        """

        try:
            response = self.model.generate_content(prompt)
            summary = response.text.strip()
            print(f"    - ✨ AI summary generated.")
            return summary
        except Exception as e:
            print(f"    - ❌ ERROR generating summary: {e}")
            if self.logger:
                 self.logger.log_failure("Summarizer_AI", {"link": url, "content_snippet": content[:100]}, e)
            return None
