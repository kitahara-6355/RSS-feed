# Project Roadmap

This document outlines the development roadmap for the RSS to Notion AI Tagger system. It tracks current features, planned improvements, and future ideas.

## v1.1: AI-Powered Analysis & Prioritization (Current Version)

The current version of the system includes the following core features:
- **Modular Architecture**: The code is split into logical modules for fetching RSS, interacting with Notion, generating tags, summarizing content, and logging errors.
- **AI-Powered Tagging**: Uses Google's Gemini AI to generate relevant tags based on an article's title.
- **AI-Powered Summarization**: A dedicated module scrapes non-Japanese articles and uses Gemini AI to generate a Japanese summary, which is saved to Notion.
- **Manual Enrichment Workflow**: A separate, manually triggered workflow (`Enrich Notion Entries`) allows users to process articles they've added to Notion by hand, applying AI tags.
- **User-Driven Priority Scoring**:
    - The system supports user-provided "Interest" and "Importance" ratings in Notion.
    - A separate script (`calculate_priority.py`) can be run to automatically calculate a weighted "Priority Score" based on these ratings.
- **Robust Automation**: All features are integrated into GitHub Actions workflows for scheduled and manual execution, with secure handling of secrets.
- **Advanced Error Logging**: Logs failures from AI or Notion processes to a `logs/` directory for monitoring.

---

## v2.0: Proactive AI Assistant (Next Steps)

The next major version will focus on making the system a proactive assistant that learns from user feedback.

- **[ ] AI-Powered Recommendation Engine**:
    - **Learning from Scores**: Implement a recurring job that analyzes the user's "Interest" and "Importance" scores in Notion.
    - **Fine-tuning**: Use this data to learn which tags, sources, or keywords the user prefers.
    - **Content Recommendation**: Proactively suggest new RSS feeds to add or remove based on this learned profile. The suggestions could be added to a new page in the Notion workspace.
- **[ ] Enhanced Notifications (Slack/Discord)**:
    - Add a new notification module for Slack or Discord.
    - Instead of notifying on every new article, send a daily or weekly digest of high-priority articles (based on the priority score) to a specified channel.
- **[ ] Article Screenshotting**:
    - Integrate a headless browser tool like Playwright.
    - Add a feature to navigate to the article URL, take a full-page screenshot, and attach it to the Notion page for archival and quick-glance purposes.

---

## Future Ideas & Vision

Long-term ideas for the evolution of the project.

- **[ ] Web UI / Dashboard**: A simple web interface to manage RSS feeds, view logs, and trigger workflows without interacting with GitHub's UI.
- **[ ] Vector Embeddings and Semantic Search**: Store vector embeddings of articles to enable powerful semantic search (e.g., "find articles similar to this one").
- **[ ] Full-Text Ingestion and Analysis**: For high-priority sources, ingest the full text of articles into Notion (or a separate vector database) to enable deeper analysis and summarization.
