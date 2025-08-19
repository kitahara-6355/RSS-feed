# Python RSS Notifier

指定した複数のRSSフィードを定期的に巡回し、新着記事が見つかった場合にスマートフォンへプッシュ通知を送るPythonスクリプトです。閲覧履歴はGoogleスプレッドシートに記録されるため、再通知を防ぎます。

このシステムはGitHub Actions上で動作するため、ご自身のPCの電源状態に関わらず、24時間365日、自動で実行されます。

## 機能
- 複数のRSSフィードの監視に対応
- 閲覧履歴をGoogleスプレッドシートに記録
- 新着記事を [ntfy.sh](https://ntfy.sh/) を通じてスマートフォンにプッシュ通知
- GitHub Actionsによる完全自動実行（1時間に1回）
- 設定ファイルとURLリストによる簡単なカスタマイズ

## 必要なもの
- Python 3.7以上（ローカルでのテスト実行にのみ必要）
- Googleアカウント
- ntfy.shのスマートフォンアプリ（[Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347)）
- GitHubアカウント

---

## セットアップ手順

このシステムを動作させるには、いくつかのサービスを連携させるための初期設定が必要です。

### ステップ1: Google Cloudとサービスアカウントの設定

スクリプトがGoogleスプレッドシートを安全に操作するために、専用の「サービスアカウント」を作成し、その認証キーを取得します。

1.  **Google Cloudプロジェクトの作成**: [Google Cloud Console](https://console.cloud.google.com/)で新しいプロジェクトを作成します。
2.  **APIの有効化**: 作成したプロジェクトで、「**Google Drive API**」と「**Google Sheets API**」を検索し、両方を有効にします。
3.  **サービスアカウントの作成**:
    - 「IAMと管理」>「サービスアカウント」で、新しいサービスアカウントを作成します（例: `rss-bot`）。ロール（権限）は不要です。
4.  **認証キー（JSON）のダウンロード**:
    - 作成したサービスアカウントの詳細画面から「キー」タブを開き、「鍵を追加」>「新しい鍵を作成」を選択します。
    - キーのタイプとして「**JSON**」を選び、作成・ダウンロードします。このファイルは後で使います。
5.  **スプレッドシートの準備と共有**:
    - Googleスプレッドシートで、履歴を記録するためのシートを新規作成します（名前は後で設定します）。
    - 右上の「共有」ボタンから、先ほど作成したサービスアカウントのメールアドレス（`...gserviceaccount.com`）を追加し、**「編集者」**の権限を与えます。

### ステップ2: ntfy.sh の設定

1.  スマートフォンに`ntfy`アプリをインストールします。
2.  アプリで、他人に推測されない**秘密のトピック名**（例: `my-secret-rss-alerts-f92jd0`）を購読します。このトピック名は後で使います。

### ステップ3: GitHub Secretsの設定 ★最重要★

このリポジトリに、あなたの個人的な設定や認証情報を安全に保管します。

1.  このGitHubリポジトリの「**Settings**」タブ > 「**Secrets and variables**」 > 「**Actions**」に移動します。
2.  「**New repository secret**」ボタンを押し、以下の**4つ**のSecretを一つずつ作成します。

    #### Secret 1: `GCP_CREDENTIALS_JSON`
    - **Name**: `GCP_CREDENTIALS_JSON`
    - **Secret**: ここには、ステップ1でダウンロードした`credentials.json`ファイルの中身を、**Base64形式に変換した文字列**を設定します。
        1.  PCで`credentials.json`の中身を全てコピーします。
        2.  [base64encode.org](https://www.base64encode.org/) などのオンラインツールを開きます。
        3.  入力欄にJSONの中身を貼り付け、「Encode」ボタンを押します。
        4.  出力された**一行の長い文字列**をコピーし、このSecretの値として貼り付けます。

    #### Secret 2: `GSPREAD_SHEET_NAME`
    - **Name**: `GSPREAD_SHEET_NAME`
    - **Secret**: ステップ1で作成したGoogleスプレッドシートの名前（例: `RSS_Feed_History`）

    #### Secret 3: `NTFY_TOPIC`
    - **Name**: `NTFY_TOPIC`
    - **Secret**: ステップ2で決めたntfyの秘密のトピック名

    #### Secret 4: `RSS_URLS`
    - **Name**: `RSS_URLS`
    - **Secret**: 監視したいRSSフィードのURLを、**1行に1つずつ**記述します。（インデントは不要です）
        ```
        https://www.site1.com/rss
        https://www.site2.com/news/feed
        ```

---

## 使い方

### 実行
上記の設定が完了すれば、**自動的に1時間ごとにスクリプトが実行されます。**

すぐに動作を確認したい場合は、手動で実行することも可能です。
1.  リポジトリの「**Actions**」タブを開きます。
2.  左側の「**Check RSS Feeds**」ワークフローを選択します。
3.  「**Run workflow**」ボタンを押します。

### URLリストの更新方法
監視するRSSフィードを変更したい場合は、GitHubの`RSS_URLS`というSecretの値を編集するだけです。
