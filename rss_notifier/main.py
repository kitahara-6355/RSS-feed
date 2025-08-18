# -*- coding: utf-8 -*-
"""
Main script for the RSS Notifier.
This script will fetch RSS feeds, check for new articles against a Google Sheet,
and send notifications for new entries.
"""
import configparser
import gspread
import feedparser
import requests
import time
from datetime import datetime

# --- Configuration ---
# The script is expected to be run from the project root directory.
CONFIG_FILE = 'config.ini'
config = configparser.ConfigParser()
config.read(CONFIG_FILE)

# Gspread settings
SERVICE_ACCOUNT_FILE = config.get('GSPREAD', 'SERVICE_ACCOUNT_FILE', fallback='credentials.json')
SHEET_NAME = config.get('GSPREAD', 'SHEET_NAME', fallback='RSS_Feed_History')

# Ntfy settings
NTFY_TOPIC = config.get('NTFY', 'TOPIC', fallback=None)

# RSS Feed URLs
URLS_TO_CHECK = config.get('RSS_FEEDS', 'URLS', fallback='').strip().split('\n')
URLS_TO_CHECK = [url.strip() for url in URLS_TO_CHECK if url.strip()]


# --- Google Sheets Functions ---

def get_worksheet():
    """Authenticates and returns the target worksheet."""
    try:
        gc = gspread.service_account(filename=SERVICE_ACCOUNT_FILE)
        try:
            spreadsheet = gc.open(SHEET_NAME)
        except gspread.exceptions.SpreadsheetNotFound:
            print(f"Spreadsheet '{SHEET_NAME}' not found. Creating a new one...")
            spreadsheet = gc.create(SHEET_NAME)
            print(f"Important: Please share the new Google Sheet '{SHEET_NAME}' with the service account email: {gc.auth.service_account_email}")

        worksheet_title = "articles"
        try:
            worksheet = spreadsheet.worksheet(worksheet_title)
        except gspread.exceptions.WorksheetNotFound:
            print(f"Worksheet '{worksheet_title}' not found. Creating a new one.")
            worksheet = spreadsheet.add_worksheet(title=worksheet_title, rows=1000, cols=5)
            worksheet.append_row(["ID", "Title", "Link", "PublishedDate", "FetchedDate"])
        return worksheet
    except FileNotFoundError:
        print(f"ERROR: Service account credentials file not found at '{SERVICE_ACCOUNT_FILE}'.")
        return None
    except Exception as e:
        print(f"An error occurred during Google Sheets setup: {e}")
        return None

def get_seen_ids(worksheet):
    """Reads article IDs from the worksheet and returns them as a set."""
    if not worksheet: return set()
    try:
        return set(worksheet.col_values(1)[1:])
    except Exception as e:
        print(f"An error occurred while reading IDs: {e}")
        return set()

def add_articles_to_sheet(worksheet, articles):
    """Appends new articles to the worksheet."""
    if not worksheet or not articles: return
    try:
        rows = []
        for article in articles:
            article_id = getattr(article, 'id', getattr(article, 'link', 'N/A'))
            title = getattr(article, 'title', 'N/A')
            link = getattr(article, 'link', 'N/A')
            published_struct = getattr(article, 'published_parsed', time.gmtime())
            published_date = time.strftime('%Y-%m-%d %H:%M:%S', published_struct)
            fetched_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            rows.append([article_id, title, link, published_date, fetched_date])
        worksheet.append_rows(rows, value_input_option='USER_ENTERED')
        print(f"Successfully added {len(rows)} new articles to '{SHEET_NAME}'.")
    except Exception as e:
        print(f"An error occurred while writing to the worksheet: {e}")

# --- RSS & Notification Functions ---

def fetch_all_articles(urls):
    """Fetches all articles from a list of RSS feed URLs."""
    all_articles = []
    if not urls:
        print("No RSS feed URLs found in config.ini.")
        return all_articles
    print(f"Fetching articles from {len(urls)} feed(s)...")
    for url in urls:
        print(f"  - Fetching {url}")
        try:
            feed = feedparser.parse(url)
            if feed.bozo:
                print(f"    WARNING: Feed at {url} may be malformed. Reason: {feed.bozo_exception}")
            all_articles.extend(feed.entries)
        except Exception as e:
            print(f"    ERROR: Could not fetch or parse feed at {url}. Reason: {e}")
    print(f"Total articles fetched: {len(all_articles)}")
    return all_articles

def send_notification(article):
    """Sends a push notification for a single article using ntfy.sh."""
    if not NTFY_TOPIC:
        return # Silently skip if topic is not set

    title = getattr(article, 'title', 'No Title')
    link = getattr(article, 'link', 'No Link')

    try:
        # Using .encode('utf-8') is important for handling special characters
        requests.post(
            f"https://ntfy.sh/{NTFY_TOPIC}",
            data=link.encode('utf-8'),
            headers={
                "Title": title.encode('utf-8'),
                "Click": link,
                "Tags": "newspaper" # Use a newspaper icon for the notification
            },
            timeout=10 # Add a timeout to prevent hanging
        )
        print(f"    - Notification sent for: {title}")
    except Exception as e:
        print(f"    - ERROR: Failed to send notification for '{title}'. Reason: {e}")

# --- Main Execution ---

def main():
    """Main function to run the RSS notifier."""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] RSS Notifier script started.")

    worksheet = get_worksheet()
    if not worksheet:
        print("Could not access worksheet. Exiting.")
        return

    seen_ids = get_seen_ids(worksheet)
    print(f"Found {len(seen_ids)} previously seen article IDs.")

    fetched_articles = fetch_all_articles(URLS_TO_CHECK)

    new_articles = []
    for article in fetched_articles:
        article_id = getattr(article, 'id', getattr(article, 'link', 'N/A'))
        if article_id not in seen_ids:
            new_articles.append(article)

    if not new_articles:
        print("No new articles found.")
    else:
        print(f"Found {len(new_articles)} new articles. Processing...")
        for article in reversed(new_articles): # Reverse to send oldest first
            send_notification(article)
            time.sleep(1) # Wait 1 second between notifications to avoid rate-limiting

        add_articles_to_sheet(worksheet, new_articles)

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Script finished.")

if __name__ == "__main__":
    main()
