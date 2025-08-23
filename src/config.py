# -*- coding: utf-8 -*-
"""
Configuration loader for the RSS to Notion system.

Loads settings from environment variables and defines constants.
"""
import os
from dotenv import load_dotenv

# Load environment variables from a .env file for local development
load_dotenv()

# --- Secrets (loaded from environment variables) ---
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# --- Application Settings ---
# List of RSS feed URLs to be processed.
# This could be moved to a separate urls.txt file or a Notion database in a future version.
RSS_FEEDS = {
    "Stratechery": "https://stratechery.passport.online/feed/rss/CSK33gZ915wtJAdPakp4b",
    "note/takahiroanno": "https://note.com/takahiroanno/rss",
    "Qiita": "https://qiita.com/feed",
    "The Verge": "https://www.theverge.com/rss/index.xml"
}

# Gemini API rate limit: 15 requests per minute (free tier).
# A 4.1 second delay ensures we stay under this limit (60 / 4.1 = 14.6 requests/min).
API_DELAY_SECONDS = 4.1

# Articles with a relevance score below this threshold will not be added to Notion.
# This score is calculated based on the user's interest profile.
FILTERING_THRESHOLD = 1.5
