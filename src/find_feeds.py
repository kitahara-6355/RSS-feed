#!/usr/bin/env python3
# src/find_feeds.py
"""
Discover candidate RSS/Atom feeds for given domains and verify them.

Usage:
  python src/find_feeds.py --domain example.com --output data/find_results.json
  python src/find_feeds.py --input data/top_domains.json --output data/find_results.json
"""
import argparse
import json
import logging
import time
import os
from urllib.parse import urljoin
import requests
import feedparser

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("find_feeds")

USER_AGENT = "rss-recommender-bot/1.0 (+https://github.com/yourname/RSS-feed)"

CANDIDATE_PATHS = [
    "/feed",
    "/rss",
    "/atom.xml",
    "/rss.xml",
    "/feed.xml",
    "/feeds/posts/default?alt=rss",
    "/index.rdf",
    "/feeds",
    "/feed/"
]


def probe_feed(url):
    """
    Try to parse the feed URL with feedparser. Return dict with status.
    """
    logger.debug("Probing feed: %s", url)
    try:
        # Set headers to avoid being blocked
        headers = {"User-Agent": USER_AGENT}
        # feedparser accepts URLs directly; still use requests to ensure 200 response
        resp = requests.get(url, headers=headers, timeout=6)
        if resp.status_code != 200:
            return {"url": url, "status": "http_error", "http_status": resp.status_code}
        parsed = feedparser.parse(resp.content)
        if parsed.bozo:
            # parsed might still have entries
            entries = parsed.get("entries", [])
            return {"url": url, "status": "parsed_bozo" if not entries else "validated", "entries": len(entries)}
        entries = parsed.get("entries", [])
        if entries:
            return {"url": url, "status": "validated", "entries": len(entries)}
        else:
            return {"url": url, "status": "no_entries"}
    except Exception as e:
        logger.debug("probe_feed exception: %s", e)
        return {"url": url, "status": "error", "error": str(e)}


def discover_feeds_for_domain(domain, try_https=True):
    """
    For a domain (e.g. 'example.com'), try common feed URLs and return candidates with validation.
    Returns list of dicts sorted with validated first.
    """
    domain = domain.strip().lower()
    schemes = ["https://", "http://"] if try_https else ["http://"]
    candidates = []
    for scheme in schemes:
        base = f"{scheme}{domain}"
        for path in CANDIDATE_PATHS:
            candidate = urljoin(base, path)
            res = probe_feed(candidate)
            candidates.append(res)
            # polite pause
            time.sleep(0.2)
    # sort so validated appears first
    candidates_sorted = sorted(candidates, key=lambda x: 0 if x.get("status") == "validated" else 1)
    return candidates_sorted


def youtube_channel_feed_from_watch(watch_url):
    """
    Try to extract a YouTube channel id from a watch URL (or channel/user page) and return feed URL.
    Logic: fetch page and search for "channelId":"UC..." or /channel/UC... in HTML.
    """
    headers = {"User-Agent": USER_AGENT}
    try:
        r = requests.get(watch_url, headers=headers, timeout=6)
        r.raise_for_status()
        html = r.text
        # first try JSON key
        import re
        m = re.search(r'"channelId"\s*:\s*"(?P<id>UC[0-9A-Za-z_-]{20,})"', html)
        if not m:
            # try to find /channel/UC...
            m = re.search(r"/channel/(?P<id>UC[0-9A-Za-z_-]{20,})", html)
        if m:
            channel_id = m.group("id")
            feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
            return {"channel_id": channel_id, "feed_url": feed_url}
        return {"channel_id": None, "feed_url": None}
    except Exception as e:
        logger.debug("youtube extraction failed: %s", e)
        return {"channel_id": None, "feed_url": None}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--domain", help="Single domain to probe (example.com)")
    p.add_argument("--input", help="JSON list of domains or imported_sources (optional)")
    p.add_argument("--top", type=int, default=50, help="Top N domains to probe when input provided")
    p.add_argument("--output", default="data/find_results.json")
    args = p.parse_args()

    domains = set()
    if args.domain:
        domains.add(args.domain)
    elif args.input:
        with open(args.input, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        # data may be list of {domain,...} or imported_sources
        # try both
        if isinstance(data, list):
            if not data:
                pass
            elif isinstance(data[0], str): # Simple list of domains
                for dom in data[:args.top]:
                    domains.add(dom)
            elif isinstance(data[0], dict): # List of objects (imported_sources)
                domain_counts = {}
                for it in data:
                    dom = it.get("domain") or ""
                    if dom:
                        domain_counts[dom] = domain_counts.get(dom, 0) + 1
                sorted_domains = sorted(domain_counts.items(), key=lambda x: x[1], reverse=True)
                for dom, cnt in sorted_domains[:args.top]:
                    domains.add(dom)
        elif isinstance(data, dict): # Domain->count mapping
            for dom in sorted(data.keys())[:args.top]:
                domains.add(dom)

    results = {}
    for dom in sorted(domains):
        logger.info("Discovering feeds for domain: %s", dom)
        candidates = discover_feeds_for_domain(dom)
        # also attempt youtube channel discovery if any youtube watch URLs present in input domain
        results[dom] = candidates

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)
    logger.info("Wrote find results to %s", args.output)


if __name__ == "__main__":
    main()
