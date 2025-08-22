# RSS to Notion: AI-Powered Learning Log

This system automatically fetches articles from RSS feeds, uses AI to generate relevant tags, and stores everything in a structured Notion database for learning and analysis. The entire process is automated with GitHub Actions.

## Features
- Fetches from multiple RSS feeds.
- **Uses Google's Gemini AI to automatically generate tags** based on article content.
- Stores articles in a Notion database.
- Prevents duplicate entries.
- Runs automatically on a schedule via GitHub Actions.

---

## Setup Instructions

To get this system running, you need to configure three services: **Notion**, **Google AI**, and **GitHub**.

### Step 1: Notion Setup
*(Instructions for setting up the Notion database and getting the Notion token/DB ID will be fully detailed here later.)*

1.  Create a Notion Database with the required properties.
2.  Create a Notion Integration to get your `NOTION_TOKEN`.
3.  Share the database with the integration.
4.  Get the `NOTION_DATABASE_ID` from the database URL.

### Step 2: Google AI (Gemini) API Key Setup
The system uses Google's Gemini model for AI features. You need to get a free API key to enable this.

1.  Go to the [Google AI Studio](https://aistudio.google.com/).
2.  Sign in with your Google account.
3.  Click the "**Get API key**" button.
4.  In the dialog that appears, click "**Create API key in new project**".
5.  Your new API key will be generated. **Copy this key** and save it somewhere safe. This is a secret password.

### Step 3: GitHub Secrets Setup
You need to add three secrets to this GitHub repository for the system to work.

1.  Go to your repository's **Settings** > **Secrets and variables** > **Actions**.
2.  Click **New repository secret** for each of the following:

    - **`NOTION_TOKEN`**: The Notion integration token you created (`secret_...` or `ntn_...`).
    - **`NOTION_DATABASE_ID`**: The ID of your Notion database.
    - **`GOOGLE_API_KEY`**: The API key you just generated from Google AI Studio.

---
*(Full usage and customization instructions will be added later.)*
