#!/usr/bin/env python3
# src/recommend_feeds.py
"""
Aggregate imported sources, discover candidate feeds (hooks into find_feeds.py),
score candidates by domain-frequency and tag-match against user_profile.json,
write data/recommended_feeds.json, and optionally push to Notion.
"""
import argparse
import json
import logging
import os
from collections import Counter, defaultdict
from subprocess import Popen, PIPE, CalledProcessError
import requests

try:
    from notion_client import Client as NotionClient
except ImportError:
    NotionClient = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("recommend_feeds")

def load_json_file(path):
    """Loads a JSON file."""
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def aggregate_domains(items, top_n=50):
    """Aggregate domains from a list of items and return the most common ones."""
    cnt = Counter()
    domain_data = defaultdict(lambda: {"urls": [], "source": "unknown"})
    for it in items:
        d = it.get("domain")
        if d:
            cnt[d] += 1
            if len(domain_data[d]["urls"]) < 5:
                domain_data[d]["urls"].append(it.get("url"))
            # Set the source type (will be overwritten but is fine for this purpose)
            domain_data[d]["source"] = it.get("source", "unknown")

    most_common_domains = cnt.most_common(top_n)
    return most_common_domains, domain_data

def call_find_feeds_for_domains(domains, out_json="data/find_results.json", top_n=10):
    """Call find_feeds.py as a subprocess to generate find_results.json."""
    domain_input_path = "data/temp_domains_to_probe.json"
    domains_to_probe = domains[:top_n]
    with open(domain_input_path, "w", encoding="utf-8") as f:
        json.dump(domains_to_probe, f)

    cmd = [
        "python", "src/find_feeds.py",
        "--input", domain_input_path,
        "--output", out_json
    ]
    logger.info(f"Running find_feeds.py (subprocess) for top {len(domains_to_probe)} domains...")
    try:
        p = Popen(cmd, stdout=PIPE, stderr=PIPE)
        out, err = p.communicate()
        if p.returncode != 0:
            logger.error(f"find_feeds.py failed with stderr:\n{err.decode('utf-8', errors='ignore')}")
            raise CalledProcessError(p.returncode, cmd, output=out, stderr=err)
        logger.info(f"find_feeds stdout:\n{out.decode('utf-8', errors='ignore')}")
    finally:
        if os.path.exists(domain_input_path):
            os.remove(domain_input_path)

    return load_json_file(out_json)

def score_candidates(find_results, domain_data, user_profile):
    """Score each domain candidate."""
    tag_weights = user_profile.get("tags", {})
    entries = []
    for domain, candidates in find_results.items():
        domain_info = domain_data.get(domain, {})
        freq = len(domain_info.get("urls", []))
        source_type = domain_info.get("source", "unknown")

        # Heuristic to get tags for the domain (can be improved later)
        tags = []

        base_score = freq
        tag_bonus = sum(float(weight) for tag, weight in tag_weights.items() if tag.lower() in domain.lower()) * 0.1

        scored_candidates = []
        for c in candidates:
            status = c.get("status")
            c_score = base_score + tag_bonus
            if status == "validated":
                c_score += 5.0
            elif status == "parsed_bozo":
                c_score += 1.0

            url = c.get("url", "")
            for tag, weight in tag_weights.items():
                if tag.lower() in url.lower():
                    c_score += float(weight) * 0.1

            c["score"] = c_score
            c["notes"] = c.get("error") or c.get("http_status")
            scored_candidates.append(c)

        scored_candidates.sort(key=lambda x: x.get("score", 0), reverse=True)
        priority_score = max([s.get("score", 0) for s in scored_candidates], default=base_score)

        entries.append({
            "domain": domain,
            "source_type": source_type,
            "example_urls": domain_info.get("urls", []),
            "candidate_feeds": scored_candidates,
            "tags": tags,
            "priority_score": priority_score
        })

    entries.sort(key=lambda x: x.get("priority_score", 0), reverse=True)
    return entries

def push_to_notion(entries, notion_token, notion_db_id):
    """Push the recommendation entries to a Notion database."""
    if not NotionClient:
        logger.error("notion-client is not installed. Skipping Notion push.")
        return
    notion = NotionClient(auth=notion_token)

    for ent in entries:
        top_candidate = next((c for c in ent["candidate_feeds"] if c.get("status") == "validated"),
                             (ent["candidate_feeds"][0] if ent["candidate_feeds"] else None))

        candidate_url = top_candidate.get("url") if top_candidate else None
        confidence = "validated" if top_candidate and top_candidate.get("status") == "validated" else "need-review"

        source_type_name = ent.get("source_type", "pocket")
        if "youtube" in source_type_name:
            source_type_name = "youtube_list"
        elif source_type_name not in ["pocket", "youtube_list"]:
             source_type_name = "pocket" # Default for safety

        props = {
            "Source Domain": {"title": [{"text": {"content": ent["domain"]}}]},
            "Source Type": {"select": {"name": source_type_name}},
            "Confidence": {"select": {"name": confidence}},
            "Priority Score": {"number": ent.get("priority_score", 0)},
            "Notes": {"rich_text": [{"text": {"content": "auto-generated"}}]},
            "Tags": {"multi_select": [{"name": t} for t in ent.get("tags", [])]},
        }
        if candidate_url:
            props["Candidate RSS"] = {"url": candidate_url}

        try:
            notion.pages.create(parent={"database_id": notion_db_id}, properties=props)
            logger.info(f"Pushed to Notion: {ent['domain']} (candidate: {candidate_url})")
        except Exception as e:
            logger.error(f"Failed to push to Notion for {ent['domain']}: {e}")

def main():
    """Main function to run the recommendation pipeline."""
    p = argparse.ArgumentParser()
    p.add_argument("--imported", default="data/imported_sources.json", help="Imported sources JSON")
    p.add_argument("--user", default="user_profile.json", help="User profile JSON (optional)")
    p.add_argument("--top", type=int, default=10, help="Top N domains to process")
    p.add_argument("--out", default="data/recommended_feeds.json")
    p.add_argument("--dry-run", action="store_true", help="Do not push to Notion")
    p.add_argument("--notion_token", default=os.environ.get("NOTION_TOKEN"))
    p.add_argument("--notion_db", default=os.environ.get("NOTION_RECOMMENDED_FEEDS_DB_ID"))
    args = p.parse_args()

    imported_items = load_json_file(args.imported)
    user_profile = load_json_file(args.user)

    top_domains, domain_data = aggregate_domains(imported_items, top_n=args.top)
    domain_list = [d for d, _ in top_domains]

    find_results = call_find_feeds_for_domains(domain_list, out_json="data/find_results.json", top_n=args.top)

    entries = score_candidates(find_results, domain_data, user_profile)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, indent=2)
    logger.info("Wrote recommendations to %s", args.out)

    if not args.dry_run and args.notion_token and args.notion_db:
        push_to_notion(entries, args.notion_token, args.notion_db)
    else:
        logger.info("Dry run or missing Notion creds — skipping push to Notion.")

if __name__ == "__main__":
    main()
