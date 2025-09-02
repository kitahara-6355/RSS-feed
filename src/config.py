# -*- coding: utf-8 -*-
"""
システムの動作を定義する設定ファイル。
APIキーやデータベースID、読み込むRSSフィードのリストなどを管理します。
"""
import os
from dotenv import load_dotenv

# .envファイルから環境変数を読み込む
load_dotenv()

# --- シークレット情報 (GitHubのSecretsに設定) ---
# Notion APIと連携するためのトークン
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
# 記事を保存するNotionデータベースのID
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
# Google AI (Gemini) のAPIキー
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# --- 動作設定 ---
# AIへのAPIリクエスト間の待ち時間（秒）。レート制限を避けるために調整。
API_DELAY_SECONDS = 10
# 記事をフィルタリングする際の関連度スコアのしきい値。これより低いスコアの記事はスキップされる。
FILTERING_THRESHOLD = 0.5

# --- RSSフィードのリスト ---
# ここに記載したフィードをシステムが巡回して記事を取得します。
RSS_FEEDS = {
    # お気に入りとリハック
    "リハック": "https://www.youtube.com/feeds/videos.xml?channel_id=UCrB4n_32A4_i1yui-5s_i3g",
    "Horiemon.com": "https://horiemon.com/feed/",
    "落合陽一": "https://note.com/ochyai/rss",
    "中島聡": "https://satoshi.blogs.com/life/atom.xml",
    "安野たかひろ": "https://note.com/takahiroanno/rss",
    "けんすう": "https://kensuu.com/feed",
    
    # 経済・政治
    "高橋洋一": "https://note.com/yoichi_takahashi/rss",
    "安田洋祐": "https://note.com/yosukeyasuda/rss",
    "週刊ダイヤモンド": "https://diamond.jp/rss/feed/atom/top.xml",
    "藤沢数希": "http://blog.livedoor.jp/kazu_fujisawa/index.rdf",
    "日経ビジネス": "https://business.nikkei.com/rss/nb/index.xml",
    "中小企業庁": "https://www.chusho.meti.go.jp/rss/index.xml",
    
    # AI・テクノロジー
    "深津貴之": "https://note.com/fladdict/rss",
    "尾原和啓": "https://note.com/kazobara/rss",
    "TechCrunch Japan": "https://jp.techcrunch.com/feed/",
    "WIRED.jp": "https://wired.jp/feed/",
    "Publickey": "https://www.publickey1.jp/atom.xml",

    # 業務効率化・ライフハック
    "Lifehacker Japan": "https://www.lifehacker.jp/feed/atom.xml",
    "倉下忠憲": "https://rashita.net/blog/feed/",
    
    # 伝統文化 × ビジネス
    "中川政七商店": "https://note.com/masashichi/rss",
    
    # 漫画・エンタメ産業
    "コミックナタリー": "https://natalie.mu/comic/feed",
    "Real Sound [ブック]": "https://realsound.jp/book/feed"
}