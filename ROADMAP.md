# Project Roadmap

This document outlines the development roadmap for the RSS to Notion AI Tagger system. It tracks current features, planned improvements, and future ideas.

## v1.2: Learning & Prioritization Engine (Current Version)

The current version of the system includes all features from v1.1, plus:
- **User Feedback Analysis**: A new, scheduled workflow (`Learn from User Feedback`) runs periodically to analyze user ratings in Notion.
- **Interest Profile Generation**: The learning script calculates weighted scores for tags and sources based on user ratings (`興味度`, `重要度`) and status (`あとで読む`, `完了`), creating a `user_profile.json` file.
- **Automated Profile Commits**: The learning workflow automatically commits the updated `user_profile.json` back to the repository, allowing the system to evolve.

---

## v2.0: Proactive AI Assistant (Next Steps)

The next major version will focus on using the learned `user_profile.json` to make the system a proactive assistant.

- **[ ] Intelligent Feed Filtering**:
    - **Action**: Modify the main `RSS to Notion AI Sync` script.
    - **Logic**: The script will load `user_profile.json` and use the tag/source scores to calculate a "relevance score" for each new article *before* adding it to Notion. Articles below a certain threshold will be discarded, reducing noise.
- **[ ] AI-Powered Feed Recommendation**:
    - **Action**: Create a new `recommend_feeds.py` script and workflow.
    - **Logic**: The script will use the top-scoring tags from `user_profile.json` to search for new, relevant RSS feeds online (e.g., via a search API or custom search).
    - **Output**: Suggestions will be added to a dedicated page in Notion for user approval.
- **[ ] Enhanced Notifications (Slack/Discord)**:
    - Send a daily or weekly digest of high-priority articles (based on the user's own ratings) to a specified Slack or Discord channel.

---

## Future Ideas & Vision

Long-term ideas for the evolution of the project.

- **[ ] Web UI / Dashboard**: A simple web interface to manage RSS feeds, view logs, and see statistics.
- **[ ] Vector Embeddings and Semantic Search**: Store vector embeddings of articles to enable powerful semantic search (e.g., "find articles similar to this one based on content, not just tags").
- **[ ] Full-Text Ingestion and Analysis**: For high-priority sources, ingest the full text of articles into Notion (or a separate vector database) to enable deeper analysis.
