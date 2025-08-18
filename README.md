# Python RSS Notifier

指定した複数のRSSフィードを定期的に巡回し、新着記事が見つかった場合にスマートフォンへプッシュ通知を送るPythonスクリプトです。閲覧履歴はGoogleスプレッドシートに記録されるため、再通知を防ぎます。

## 機能
- 複数のRSSフィードの監視に対応
- 閲覧履歴をGoogleスプレッドシートに記録
- 新着記事を [ntfy.sh](https://ntfy.sh/) を通じてスマートフォンにプッシュ通知
- 設定ファイルによる簡単なカスタマイズ

## 必要なもの
- Python 3.7以上
- Googleアカウント
- ntfy.shのスマートフォンアプリ（[Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347)）

---

## セットアップ手順

### ステップ1: Google Cloud APIとサービスアカウントの設定

このスクリプトがGoogleスプレッドシートを操作するには、APIへのアクセス許可が必要です。以下の手順で「サービスアカウント」を作成し、認証用のキーファイルを取得します。

1.  **Google Cloudプロジェクトの作成**
    - [Google Cloud Console](https://console.cloud.google.com/)にアクセスします。
    - 新しいプロジェクトを作成します（既存のプロジェクトでも構いません）。

2.  **APIの有効化**
    - 作成したプロジェクトの「[APIとサービス](https://console.cloud.google.com/apis/library)」に移動します。
    - 「**Google Drive API**」を検索して有効にします。
    - 同様に、「**Google Sheets API**」を検索して有効にします。

3.  **サービスアカウントの作成**
    - 「[IAMと管理] > [サービスアカウント](https://console.cloud.google.com/iam-admin/serviceaccounts)」に移動します。
    - 「**+ サービスアカウントを作成**」をクリックします。
    - サービスアカウント名（例: `rss-notifier-bot`）を入力し、「作成して続行」をクリックします。
    - ロールは不要なので、そのまま「完了」をクリックします。

4.  **キーファイルのダウンロード**
    - 作成したサービスアカウントのメールアドレスをクリックします。
    - 「キー」タブに移動し、「鍵を追加」 > 「新しい鍵を作成」を選択します。
    - キーのタイプとして「**JSON**」を選択し、「作成」をクリックします。
    - `credentials.json`のような名前のファイルがダウンロードされます。**このファイルは非常に重要なので、安全な場所に保管してください。**

5.  **Googleスプレッドシートの共有設定**
    - スクリプトが作成・編集するGoogleスプレッドシートは、このサービスアカウントと共有されている必要があります。
    - **最初のスクリプト実行時に、コンソールにサービスアカウントのメールアドレスが表示されます。**
    - スクリプトによって自動作成されたGoogleスプレッドシートを開き、右上の「共有」ボタンをクリックします。
    - 表示されたサービスアカウントのメールアドレス（例: `...iam.gserviceaccount.com`）を「ユーザーやグループを追加」の欄に貼り付け、「編集者」の権限を与えて共有します。

### ステップ2: ntfy.sh の設定

1.  お使いのスマートフォンに`ntfy`アプリをインストールします。
2.  アプリを開き、「Subscribe to topic」をタップします。
3.  後で`config.ini`に設定する、**自分だけの秘密のトピック名**（例: `my-secret-rss-alerts-f92jd0`）を入力し、購読します。

### ステップ3: プロジェクトのセットアップ

1.  このプロジェクトのファイルをダウンロード、またはクローンします。
2.  ターミナル（コマンドプロンプト）で、このプロジェクトのディレクトリに移動します。
3.  **仮想環境の作成と有効化**（推奨）:
    ```bash
    python -m venv venv
    # Windowsの場合
    venv\Scripts\activate
    # macOS / Linuxの場合
    source venv/bin/activate
    ```
4.  **必要なライブラリのインストール**:
    ```bash
    pip install -r requirements.txt
    ```

### ステップ4: `config.ini` の設定

プロジェクトルートにある`config.ini`ファイルを編集します。

- `SERVICE_ACCOUNT_FILE`: ステップ1でダウンロードした**JSONキーファイルのパス**を指定します。（例: `C:\Users\YourUser\Documents\credentials.json` や `path/to/your/credentials.json`）
- `SHEET_NAME`: 履歴を保存するGoogleスプレッドシートの名前です。お好みで変更できます。
- `TOPIC`: ステップ2で決めた**ntfyのトピック名**をここに設定します。
- `URLS`: 監視したいRSSフィードのURLを、一行ずつインデントして記述します。

---

## 使い方

### 手動実行

設定が完了したら、プロジェクトのルートディレクトリで以下のコマンドを実行します。

```bash
python rss_notifier/main.py
```

### 自動実行（スケジューリング）

このスクリプトを定期的に自動実行することで、情報収集を完全に自動化できます。

#### cron (macOS / Linux)
`crontab -e`コマンドでcron設定ファイルを開き、以下のような行を追加します。（1時間ごとに実行する例）

```cron
0 * * * * /path/to/your/project/venv/bin/python /path/to/your/project/rss_notifier/main.py >> /path/to/your/project/cron.log 2>&1
```
※パスはご自身の環境に合わせて修正してください。

#### タスクスケジューラ (Windows)
1.  タスクスケジューラを開きます。
2.  「基本タスクの作成」から、トリガー（毎日、など）を設定します。
3.  操作として「プログラムの開始」を選択します。
4.  「プログラム/スクリプト」に、作成した仮想環境の`python.exe`のフルパスを指定します。（例: `C:\path\to\your\project\venv\Scripts\python.exe`）
5.  「引数の追加」に、`main.py`のフルパスを指定します。（例: `C:\path\to\your\project\rss_notifier\main.py`）
6.  「開始（オプション）」に、プロジェクトのルートディレクトリのパスを指定します。

---

## 設定ファイルの詳細 (`config.ini`)

```ini
[GSPREAD]
SERVICE_ACCOUNT_FILE = credentials.json
SHEET_NAME = RSS_Feed_History

[NTFY]
TOPIC = your-ntfy-topic

[RSS_FEEDS]
URLS =
    https://example.com/rss/feed1.xml
    https://anotherexample.com/feed
```
- **SERVICE_ACCOUNT_FILE**: 認証情報ファイルへのパス。
- **SHEET_NAME**: 使用するGoogleスプレッドシートのドキュメント名。
- **TOPIC**: 通知を送るntfy.shのトピック。
- **URLS**: 監視対象のRSSフィード。=の後に改行し、インデントしてURLを複数記述できます。
