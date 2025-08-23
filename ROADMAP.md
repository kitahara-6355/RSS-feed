# Project Roadmap

This document outlines the development roadmap for the RSS to Notion AI Tagger system. It tracks current features, planned improvements, and future ideas.

## v1.3: Intelligent Filtering Engine (Current Version)

The current version of the system includes all features from v1.2, plus:
- **[x] Intelligent Feed Filtering**: The main sync script now loads the `user_profile.json`. It calculates a "relevance score" for each new article based on the learned preferences for tags and sources. Articles that fall below a configurable `FILTERING_THRESHOLD` are automatically skipped, reducing noise and ensuring only relevant content is added to Notion.

---

## v2.0: Proactive AI Assistant (Next Steps)

The next major version will focus on making the system a proactive assistant that learns from user feedback.

- **[ ] AI-Powered Feed Recommendation**:
    - **Action**: Create a new `recommend_feeds.py` script and workflow.
    - **Logic**: The script will use the top-scoring tags from `user_profile.json` to search for new, relevant RSS feeds online (e.g., via a search API or custom search).
    - **Output**: Suggestions will be added to a dedicated page in Notion for user approval.
- **[ ] Enhanced Notifications (Slack/Discord)**:
    - Add a new notification module for Slack or Discord.
    - Instead of notifying on every new article, send a daily or weekly digest of high-priority articles (based on the user's own ratings) to a specified channel.
- **[ ] Article Screenshotting**:
    - Integrate a headless browser tool like Playwright.
    - Add a feature to navigate to the article URL, take a full-page screenshot, and attach it to the Notion page for archival and quick-glance purposes.

---

## Future Ideas & Vision

Long-term ideas for the evolution of the project.

- **[ ] Web UI / Dashboard**: A simple web interface to manage RSS feeds, view logs, and see statistics.
- **[ ] Vector Embeddings and Semantic Search**: Store vector embeddings of articles to enable powerful semantic search (e.g., "find articles similar to this one based on content, not just tags").
- **[ ] Full-Text Ingestion and Analysis**: For high-priority sources, ingest the full text of articles into Notion (or a separate vector database) to enable deeper analysis.
