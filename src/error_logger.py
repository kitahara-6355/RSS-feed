# -*- coding: utf-8 -*-
"""
Module for logging errors to a file in JSON format.
"""
import os
import json
from datetime import datetime
from typing import Dict, Any

class ErrorLogger:
    """Handles logging of errors, especially AI-related failures."""
    def __init__(self, log_dir: str = "logs"):
        self.log_dir = log_dir
        # Ensure the log directory exists
        os.makedirs(self.log_dir, exist_ok=True)

        # Define a log file for the current run
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_file = os.path.join(self.log_dir, f"run_errors_{timestamp}.jsonl")
        print(f"📝 Logging errors to: {self.log_file}")

    def log_failure(self, component: str, article_data: Dict[str, Any], error: Exception):
        """
        Logs details of a processing failure to a JSONL file.

        Args:
            component: The name of the component that failed (e.g., 'AI_Tagger', 'Notion_Client').
            article_data: The article data that caused the failure.
            error: The exception object.
        """
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "component": component,
            "article_title": article_data.get("title", "N/A"),
            "article_url": article_data.get("link", "N/A"),
            "error_message": str(error)
        }

        try:
            # Append the JSON object as a new line in the file (JSONL format)
            with open(self.log_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
        except Exception as e:
            # If logging itself fails, print to console as a fallback
            print(f"❌ CRITICAL: Failed to write to log file! Error: {e}")
            print(f"   - Original log entry was: {log_entry}")
