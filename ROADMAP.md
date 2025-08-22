# Project Roadmap

This document outlines the development roadmap for the RSS to Notion AI Tagger system. It tracks current features, planned improvements, and future ideas.

## v1.0: AI-Powered Tagger (Current Version)

The current version of the system includes the following core features:
- **Modular Architecture**: The code is split into logical modules for fetching RSS (`rss_fetcher`), interacting with Notion (`notion_handler`), generating tags (`ai_tagger`), configuration (`config`), and error logging (`error_logger`).
- **RSS Feed Processing**: Fetches articles from a predefined list of RSS URLs.
- **Notion Integration**:
    - Checks for duplicate articles in a Notion database by URL to prevent re-adding.
    - Creates new pages in Notion for new articles, populating properties like Title, URL, Author, Source, Status, Publication Date, and Tags.
- **AI-Powered Tagging**:
    - Uses Google's Gemini AI to generate relevant tags based on an article's title.
    - Includes a fail-safe to assign a default "その他" tag if the AI fails.
- **Advanced Error Logging**:
    - Creates a `logs/` directory.
    - Logs any errors from the AI or Notion processes to a timestamped JSONL file for easy debugging.
- **Automated Execution**:
    - A GitHub Actions workflow runs the entire pipeline on a schedule (every 6 hours) and can be triggered manually.
    - All secrets (Notion Token, Database ID, Google API Key) are handled securely via GitHub Secrets.
- **Rate Limiting**: Includes a delay between processing articles to respect the free-tier limits of the Google AI API.

---

## v1.1: Near-Term Improvements (Next Steps)

The following are planned enhancements to improve usability and robustness.

- **[ ] External Feed Configuration**: Move the hardcoded `RSS_FEEDS` dictionary from `src/config.py` to a separate `urls.json` or `urls.txt` file that can be managed without changing the code.
- **[ ] Enhanced Error Notifications**: In addition to logging errors, implement a system to send a notification (e.g., via ntfy or email) if the workflow run fails completely.
- **[ ] More Sophisticated AI Prompting**:
    - Refine the prompt sent to the Gemini AI to generate more structured output, potentially including a primary category in addition to tags.
    - Use the article summary (in addition to the title) for more accurate tagging, while being mindful of token limits.
- **[ ] Batch Processing for Notion**: Update the Notion client to add multiple new pages in a single batch request to improve efficiency and reduce API calls, where the Notion API supports it.

---

## v2.0: Major Feature Upgrades

These are larger features that would significantly expand the system's capabilities.

- **[ ] Slack/Discord Notification Integration**:
    - Add a new notification module.
    - Implement functionality to send summaries of newly added articles to a specified Slack or Discord channel via webhooks, perhaps only for articles with a certain tag.
- **[ ] Article Screenshotting**:
    - Integrate a headless browser tool like Playwright.
    - Add a feature to navigate to the article URL and take a full-page screenshot.
    - Upload the screenshot to Notion's own file storage and embed it in the page.
- **[ ] AI-Powered Summarization**:
    - Enhance the `ai_tagger.py` module (or create a new `ai_summarizer.py`).
    - Implement a feature to generate a concise summary of the article.
    - Add the summary to a dedicated "Summary" property in the Notion database.

---

## Future Ideas & Vision

Long-term ideas for the evolution of the project.

- **[ ] Web UI / Dashboard**: A simple web interface (e.g., using Flask or Streamlit) to manage RSS feeds, view logs, and see statistics.
- **[ ] Interactive AI Feedback Loop**: Allow the user to correct or add tags in Notion. A separate script could periodically read these manual changes to fine-tune the AI's tagging rules or prompt, creating a self-improving system.
- **[ ] Vector Embeddings and Semantic Search**: Store vector embeddings of articles to enable powerful semantic search within the Notion database (e.g., "find articles similar to this one").
- **[ ] Priority Scoring**: Develop a system to score articles based on source, keywords, and other metrics to automatically assign a "Priority" level in Notion.
