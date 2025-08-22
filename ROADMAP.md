# Project Roadmap

This document outlines the development roadmap for the RSS to Notion AI Tagger system. It tracks current features, planned improvements, and future ideas.

## v1.0: Initial Release (Current Version)

The current version of the system includes the following core features:
- **Modular Architecture**: The code is split into logical modules for fetching RSS (`rss_fetcher`), interacting with Notion (`notion_client`), generating tags (`ai_tagger`), and configuration (`config`).
- **RSS Feed Processing**: Fetches articles from a predefined list of RSS URLs.
- **Notion Integration**:
    - Checks for duplicate articles in a Notion database by URL to prevent re-adding.
    - Creates new pages in Notion for new articles.
- **AI-Powered Tagging**:
    - Uses Google's Gemini AI to generate relevant tags based on an article's title and summary.
    - Includes a fail-safe to assign a default tag if the AI fails.
- **Advanced Error Logging**:
    - Creates a `logs/` directory.
    - Logs any errors from the AI tagging process to a timestamped JSONL file for easy debugging and monitoring.
- **Automated Execution**:
    - A GitHub Actions workflow runs the entire pipeline on a schedule (e.g., every 6 hours) and can be triggered manually.
    - All secrets (Notion Token, Google API Key) are handled securely via GitHub Secrets.

---

## v1.1: Near-Term Improvements (Next Steps)

The following are planned enhancements to improve usability and robustness.

- **[ ] External Feed Configuration**: Move the hardcoded `RSS_FEEDS` dictionary from `src/config.py` to an external `urls.txt` file that can be managed without changing the code.
- **[ ] Enhanced Error Notifications**: In addition to logging errors to a file, implement a system to send a notification (e.g., via ntfy or email) if the workflow fails, allowing for quicker intervention.
- **[ ] More Sophisticated AI Prompting**: Refine the prompt sent to the Gemini AI to generate more structured output, potentially including a confidence score or primary/secondary tags.
- **[ ] Batch Processing for Notion**: Update the Notion client to add multiple new pages in a single batch request where possible, to improve efficiency and reduce API calls.

---

## v2.0: Major Feature Upgrades

These are larger features that would significantly expand the system's capabilities.

- **[ ] Slack/Discord Notification Integration**:
    - Add a new `notification_client.py` module.
    - Implement functionality to send summaries of newly added articles to a specified Slack or Discord channel via webhooks.
- **[ ] Article Screenshotting**:
    - Integrate a headless browser tool like Playwright or Selenium.
    - Add a feature to navigate to the article URL and take a full-page screenshot.
    - Upload the screenshot to a service (like Google Cloud Storage or Notion's own file storage) and link it in the Notion page.
- **[ ] AI-Powered Summarization**:
    - Create a new `ai_summarizer.py` module.
    - Implement a feature to send the full article text (or a scraped version) to the AI to generate a concise summary.
    - Add the summary to a dedicated "Summary" property in the Notion database.

---

## Future Ideas & Vision

Long-term ideas for the evolution of the project.

- **[ ] Web UI / Dashboard**: A simple web interface (e.g., using Flask or Streamlit) to manage RSS feeds, view logs, and see statistics without needing to edit files or check GitHub.
- **[ ] Interactive AI Feedback Loop**: Allow the user to correct or add tags in Notion. A separate script could periodically read these manual changes to fine-tune the AI's tagging rules or prompt, creating a self-improving system.
- **[ ] Vector Embeddings and Semantic Search**: Store vector embeddings of articles to enable powerful semantic search within the Notion database (e.g., "find articles similar to this one").
- **[ ] Priority Scoring**: Develop a system to score articles based on source, keywords, and other metrics to automatically assign a "Priority" level in Notion.
