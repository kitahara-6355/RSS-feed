#!/usr/bin/env python3
# src/recommend_feeds.py
"""
Aggregate imported sources, discover candidate feeds (hooks into find_feeds.py),
score candidates by domain-frequency and tag-match against user_profile.json,
write data/recommended_feeds.json, and optionally push to Notion.

Usage:
  python src/recommend_feeds.py --imported data/imported_sources.json --user user_profile.json --out data/recommended_feeds.json --dry-run
"""
import argparse
import json
import logging
import os
from collections import Counter, defaultdict

# internal modules (same repo)
from subprocess import Popen, PIPE, CalledProcessError
import requests

# notion client optional
try:
    from notion_client import Client as NotionClient
except Exception:
    NotionClient = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("recommend_feeds")


def load_imported(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_user_profile(path):
    """
    Expect user_profile.json schema like:
    {
      "tags": {"AI": 5, "Business": 3, ...},
      "preferences": {...}
    }
    If not present, returns empty dict.
    """
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def aggregate_domains(items, top_n=50):
    cnt = Counter()
    domain_example_urls = defaultdict(list)
    for it in items:
        d = it.get("domain", "")
        if d:
            cnt[d] += 1
            if len(domain_example_urls[d]) < 5 and it.get("url"):
                domain_example_urls[d].append(it.get("url"))
    most = cnt.most_common(top_n)
    return most, domain_example_urls


def call_find_feeds_for_domains(domains, out_json="data/find_results.json", top_n=10):
    """
    Call find_feeds.py as a subprocess to generate find_results.json.
    """
    domain_input_path = "data/temp_domains_to_probe.json"
    # We pass only the top N domains to the subprocess
    domains_to_probe = domains[:top_n]
    with open(domain_input_path, "w", encoding="utf-8") as f:
        # find_feeds.py now accepts a simple list of domains
        json.dump(domains_to_probe, f)

    cmd = [
        "python", "src/find_feeds.py",
        "--input", domain_input_path,
        "--output", out_json
    ]
    logger.info(f"Running find_feeds.py (subprocess) for top {len(domains_to_probe)} domains...")
    p = Popen(cmd, stdout=PIPE, stderr=PIPE)
    out, err = p.communicate()
    logger.info("find_feeds stdout:\n%s", out.decode("utf-8", errors="ignore"))
    if err:
        logger.debug("find_feeds stderr:\n%s", err.decode("utf-8", errors="ignore"))
    if p.returncode != 0:
        raise CalledProcessError(p.returncode, cmd, output=out, stderr=err)

    # Clean up the temporary file
    os.remove(domain_input_path)

    with open(out_json, "r", encoding="utf-8") as fh:
        return json.load(fh)


def score_candidates(find_results, domain_example_urls, user_profile):
    """
    Score each domain candidate based on:
      - domain frequency (higher better)
      - tag match with user_profile tags
    Returns a list of entries ready to output.
    """
    # prepare tag weights from user_profile
    tag_weights = user_profile.get("tags", {}) if isinstance(user_profile, dict) else {}
    entries = []
    for domain, candidates in find_results.items():
        freq = len(domain_example_urls.get(domain, []))
        # gather tags heuristically (from example urls or domain)
        # for now we'll use empty tags; later, we can enrich by crawling titles.
        tags = []
        # compute base score by freq
        base_score = freq
        # add tag match bonus (if tag appears in domain or candidate url)
        tag_bonus = 0.0
        domain_lower = domain.lower()
        for tag, weight in tag_weights.items():
            if tag.lower() in domain_lower:
                tag_bonus += float(weight) * 0.1
        # evaluate candidates: prefer validated ones
        scored_candidates = []
        for c in candidates:
            status = c.get("status")
            c_score = base_score
            if status == "validated":
                c_score += 5.0
            elif status in ("parsed_bozo",):
                c_score += 1.0
            # add tag bonus per candidate url
            url = c.get("url","")
            for tag, weight in tag_weights.items():
                if tag.lower() in url.lower():
                    c_score += float(weight)*0.1
            scored_candidates.append({"url": url, "status": status, "entries": c.get("entries"), "score": c_score, "notes": c.get("error") or c.get("http_status")})
        # sort candidates by score desc
        scored_candidates = sorted(scored_candidates, key=lambda x: x.get("score",0), reverse=True)
        priority_score = max([s.get("score",0) for s in scored_candidates]) if scored_candidates else base_score
        entries.append({
            "domain": domain,
            "example_urls": domain_example_urls.get(domain, []),
            "candidate_feeds": scored_candidates,
            "tags": tags,
            "priority_score": priority_score
        })
    # sort entries by priority
    entries = sorted(entries, key=lambda x: x.get("priority_score",0), reverse=True)
    return entries


def push_to_notion(entries, notion_token, notion_db_id):
    if NotionClient is None:
        logger.error("notion-client is not installed or importable. Skipping Notion push.")
        return
    notion = NotionClient(auth=notion_token)
    for ent in entries:
        # choose top validated candidate if exists
        top = next((c for c in ent["candidate_feeds"] if c.get("status") == "validated"), (ent["candidate_feeds"][0] if ent["candidate_feeds"] else None))
        candidate_url = top.get("url") if top else None
        confidence = "validated" if top and top.get("status") == "validated" else "need-review"
        props = {
            "Source Domain": {"title": [{"text": {"content": ent["domain"]}}]},
            "Candidate RSS": {"url": candidate_url} if candidate_url else {},
            "Confidence": {"select": {"name": confidence}},
            "Tags": {"multi_select": [{"name": t} for t in ent.get("tags", [])]} if ent.get("tags") else {},
            "Priority Score": {"number": ent.get("priority_score", 0)},
            "Notes": {"rich_text": [{"text": {"content": "auto-generated"}}]},
        }
        try:
            notion.pages.create(parent={"database_id": notion_db_id}, properties=props)
            logger.info("Pushed to Notion: %s (candidate: %s)", ent["domain"], candidate_url)
        except Exception as e:
            logger.error("Failed to push to Notion for %s: %s", ent["domain"], e)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--imported", default="data/imported_sources.json", help="Imported sources JSON")
    p.add_argument("--user", default=None, help="user_profile.json (optional)")
    p.add_argument("--top", type=int, default=10, help="Top N domains to process to avoid timeouts")
    p.add_argument("--out", default="data/recommended_feeds.json")
    p.add_argument("--dry-run", action="store_true", help="Do not push to Notion")
    p.add_argument("--notion_token", default=os.environ.get("NOTION_TOKEN"))
    p.add_argument("--notion_db", default=os.environ.get("NOTION_RECOMMENDED_FEEDS_DB_ID"))
    args = p.parse_args()

    imported = load_imported(args.imported)
    user_profile = load_user_profile(args.user)
    top_domains, domain_example_urls = aggregate_domains(imported, top_n=args.top)

    find_results = call_find_feeds_for_domains(
        [d for d, _ in top_domains],
        out_json="data/find_results.json",
        top_n=args.top
    )
    entries = score_candidates(find_results, domain_example_urls, user_profile)

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
