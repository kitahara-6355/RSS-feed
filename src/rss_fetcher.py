# -*- coding: utf-8 -*-
"""
Module for fetching and parsing RSS feeds.
"""
import feedparser
from typing import List, Dict, Any

def fetch_articles_from_feed(url: str) -> List[Dict[str, Any]]:
    """
    Fetches articles from a single RSS feed URL.

    Args:
        url: The URL of the RSS feed.

    Returns:
        A list of article entries, where each entry is a dictionary-like object
        provided by feedparser.
    """
    print(f"  - Fetching articles from {url}")
    try:
        feed = feedparser.parse(url)
        if feed.bozo:
            print(f"    ⚠️ Warning: Feed at {url} may be malformed. Reason: {feed.bozo_exception}")
        return feed.entries
    except Exception as e:
        print(f"  - ❌ ERROR: Could not fetch or parse feed at {url}. Reason: {e}")
        return []
