Run python src/push_recommendations_to_notion.py
  python src/push_recommendations_to_notion.py
  shell: /usr/bin/bash -e {0}
  env:
    pythonLocation: /opt/hostedtoolcache/Python/3.11.13/x64
    PKG_CONFIG_PATH: /opt/hostedtoolcache/Python/3.11.13/x64/lib/pkgconfig
    Python_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
    Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
    Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
    LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.11.13/x64/lib
    NOTION_TOKEN: ***
    NOTION_DATABASE_ID: ***
    NOTION_SUGGESTIONS_PAGE_ID: *** 
Traceback (most recent call last):
  File "/home/runner/work/RSS-feed/RSS-feed/src/push_recommendations_to_notion.py", line 43, in <module>
    push_to_notion()
  File "/home/runner/work/RSS-feed/RSS-feed/src/push_recommendations_to_notion.py", line 16, in push_to_notion
    raise EnvironmentError("❌ Missing NOTION_API_KEY or NOTION_DATABASE_ID environment variables")
OSError: ❌ Missing NOTION_API_KEY or NOTION_DATABASE_ID environment variables
Error: Process completed with exit code 1.
