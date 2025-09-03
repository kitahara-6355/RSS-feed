# -*- coding: utf-8 -*-
"""
Module for fetching and parsing RSS feeds.
"""
import feedparser
from typing import List, Dict, Any
from urllib.parse import urlparse

def fetch_articles_from_feed(url: str) -> List[Dict[str, Any]]:
    """
    Fetches articles from a single RSS feed URL.

    Args:
        url: The URL of the RSS feed.

    Returns:
        A list of article entries, where each entry is a dictionary-like object
        provided by feedparser. Returns an empty list if fetching fails.
    """
    print(f"  - Fetching articles from {url}")
    try:
        feed = feedparser.parse(url)
        if feed.bozo:
            # Bozo flag is set if the feed is not well-formed.
            # We still try to process it but log a warning.
            print(f"    ⚠️ Warning: Feed at {url} may be malformed. Reason: {feed.bozo_exception}")
        return feed.entries
    except Exception as e:
        print(f"  - ❌ ERROR: Could not fetch or parse feed at {url}. Reason: {e}")
        return []

def get_source_from_url(url: str) -> str:
    """
    Extracts the domain name from a URL.
    e.g. https://www.example.com/path/to/article -> example.com

    Args:
        url: The URL of the article.

    Returns:
        The domain name (e.g., 'example.com'). Returns an empty string on failure.
    """
    if not url:
        return ""
    try:
        netloc = urlparse(url).netloc
        # Remove 'www.' if it exists and return
        if netloc.startswith('www.'):
            return netloc[4:]
        return netloc
    except Exception as e:
        print(f"  - ❌ ERROR: Could not parse URL {url}. Reason: {e}")
        return ""