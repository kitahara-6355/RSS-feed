# -*- coding: utf-8 -*-
"""
Configuration loader for the RSS to Notion system.

Loads settings from environment variables and defines constants.
"""
import os
from dotenv import load_dotenv

# Load environment variables from a .env file for local development
load_dotenv()

# --- Secrets ---
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") # For Gemini

# --- Settings ---
# A list of RSS feed URLs to be processed.
# In a real application, this might come from a file or a Notion database.
RSS_FEEDS = {
    "Stratechery": "https://stratechery.passport.online/feed/rss/CSK33gZ915wtJAdPakp4b",
    "note/takahiroanno": "https://note.com/takahiroanno/rss",
    "Qiita": "https://qiita.com/feed",
    "The Verge": "https://www.theverge.com/rss/index.xml"
}
