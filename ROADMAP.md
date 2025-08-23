# Project Roadmap

This document outlines the development roadmap for the RSS to Notion AI Tagger system. It tracks current features, planned improvements, and future ideas.

## v2.0: Proactive AI Assistant (Current Version)

The system has now evolved into a proactive assistant that learns from feedback and suggests new content.

- **[x] Intelligent Feed Filtering**: The main sync script uses the learned `user_profile.json` to calculate a "relevance score" for new articles and filters out those below a certain threshold.
- **[x] AI-Powered Feed Recommendation**: A new, scheduled workflow (`Recommend New Feeds`) uses the top-rated tags from the user profile to search for new, relevant RSS feeds and suggests them on a dedicated Notion page.
- **[x] Learning & Prioritization Engine**: The system analyzes user ratings in Notion to build an interest profile (`user_profile.json`) and supports manual calculation of priority scores.

---

## v2.1: Near-Term Improvements (Next Steps)

- **[ ] Enhanced Notifications (Slack/Discord)**:
    - Add a new notification module for Slack or Discord.
    - Send a daily or weekly digest of high-priority articles (based on the user's own ratings) to a specified channel, instead of notifying for every new article.
- **[ ] Article Screenshotting**:
    - Integrate a headless browser tool like Playwright.
    - Add a feature to navigate to the article URL, take a full-page screenshot, and attach it to the Notion page for archival.
- **[ ] Refine Recommendation Logic**: Improve the web scraping and parsing logic in `recommend_feeds.py` to more accurately identify valid RSS feed URLs from search results.

---

## Future Ideas & Vision

- **[ ] Web UI / Dashboard**: A simple web interface to manage RSS feeds, view logs, and trigger workflows.
- **[ ] Vector Embeddings and Semantic Search**: Store vector embeddings of articles to enable powerful semantic search (e.g., "find articles similar to this one").
- **[ ] Full-Text Ingestion and Analysis**: For high-priority sources, ingest the full text of articles into Notion or a vector database for deeper analysis.
