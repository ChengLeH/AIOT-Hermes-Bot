# AIOT / Hermes Bot

**v0.1.3 · your agent, in your pocket**

AIOT is a mobile-first PWA frontend for a Hermes Bot running on your own computer. It discovers the profiles exposed by Hermes and presents each profile as a contact. Messages, attachments, Markdown, code blocks, approvals, interrupt controls, search, notifications, and downloadable files stay connected to your local Hermes Bot.

> Platform status: v0.1.3 has been tested on macOS and Android Chrome/PWA. Windows and iPhone installation have not been tested yet.

**v0.1.3 UI follow-up:** centered batch-upload animations, approval dismissal, Bot avatar scheduling selector and activity glow. [Full bilingual changes](CHANGELOG.md#ui-follow-up--介面追加更新).

**v0.1.3 介面追加更新：**整批上傳中央動畫、批准提示收起、排程 Bot 頭像選單與工作文字光暈。[完整中英文紀錄](CHANGELOG.md)。

![AIOT synthetic preview in English](docs/images/v0.1.2-en.svg)

The illustrations below are synthetic UI previews, not live conversations or evidence of backend execution. English and Traditional Chinese examples use their matching UI language.

![Upload feedback preview](docs/images/v0.1.3-upload-en.svg)

![上傳結果示意](docs/images/v0.1.3-upload-zh-TW.svg)

## English

### What runs where

- **Hermes Bot service** runs on your computer and owns profiles, conversations, model work, files, and approvals.
- **AIOT local service** runs at `http://127.0.0.1:8888`. It serves the PWA, runs the notification relay, and forwards `/api/bot` traffic to your existing local Hermes Bot endpoint.
- **Tailscale HTTPS URL** is the private address your phone opens. After setup, the same URL serves AIOT while AIOT forwards Bot requests locally.

AIOT does not contain a model and does not replace Hermes. It does not require a fixed profile list or a hard-coded Hermes port.

### Requirements

1. macOS 12 or newer. macOS and Android Chrome/PWA are the platforms tested for v0.1.3.
2. [Node.js](https://nodejs.org/) 22.12 or newer.
3. [Tailscale](https://tailscale.com/download) installed and signed in on the computer and phone. The `tailscale` command must be available on the computer’s PATH and able to run `tailscale serve status --json`.
4. A working Hermes Bot endpoint with the `/api/bot` profile, message, event, attachment, completion, interrupt, and approval routes enabled. Hermes 0.21.x profiles that expose the official Runs, Skills, approval, and stop endpoints are detected automatically; profiles without them keep using the existing Bot transport.
5. A Tailscale Serve HTTPS origin that currently forwards to the local Hermes Bot service. AIOT reads this existing mapping during setup, so you do not enter or hard-code the local Hermes port in AIOT.

A generic model API or a Hermes Session web page is not sufficient: the existing Hermes installation must expose the Bot adapter routes above. AIOT does not install that adapter or change Hermes settings. The Serve destination must be a loopback HTTP service on the same computer.

### Create the connection key

If your Bot adapter already has a connection key, use that key. Otherwise generate a random key of at least 32 characters on the Hermes computer:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put that value in the Hermes Bot PWA/browser platform's `connection_key` setting, then restart Hermes through the normal Hermes app flow so the Bot endpoint uses the new key. Keep the key private. This is the AIOT-to-Hermes connection key, not a model-provider API key.

### Install and connect on macOS

1. Download this repository and unzip it.
2. Confirm Hermes Bot is running and its Tailscale HTTPS URL already reaches the Hermes Bot endpoint.
3. Double-click **AIOT.app**. On the first launch, macOS may require right-clicking the app and choosing **Open**.
4. AIOT installs its JavaScript dependencies when needed, builds the PWA, starts the local AIOT service at `127.0.0.1:8888`, and opens the setup page. No Terminal window needs to remain open.
5. Enter the full Tailscale HTTPS origin, including its port when one is present, for example `https://your-machine.example.ts.net:10000`. Do not add a path.
6. Enter the connection key created above and select **Connect Hermes**.
7. AIOT checks the key, discovers the existing local Hermes Bot destination from Tailscale Serve, then changes that HTTPS origin to serve AIOT at port 8888. The browser redirects to the same Tailscale URL.
8. Confirm the contact list appears, open a non-critical profile, and send a unique test message.
9. Install the PWA from Chrome on Android or **Add to Home Screen** from Safari on iPhone.

Double-click **AIOT.app** again to reopen an already running service. Double-click **Stop AIOT.app** to stop the background AIOT service. Starting or stopping AIOT does not restart Hermes.

### Local files and security

- `.aiot/runtime.json` stores only the discovered loopback Hermes Bot destination. It does not store the browser connection key.
- When notifications are enabled, `.aiot/push-private.json` stores push keys, the Hermes authorization credential, subscriptions, and delivery state as AES-256-GCM ciphertext. On macOS the encryption key is kept in Login Keychain; if Keychain is unavailable, AIOT uses a separate mode-0600 local key. These files are local private data and must never be shared.
- `.aiot/aiot.log` and `.aiot/aiot.pid` belong to the local AIOT service. The entire `.aiot` directory is excluded from Git.
- The browser stores the connection key as AES-256-GCM ciphertext in IndexedDB, bound to the configured HTTPS origin. The Web Crypto encryption key is non-extractable; it is not a hardware-backed credential guarantee and does not protect against same-origin XSS or a compromised browser. If encrypted persistence is unavailable, AIOT uses memory only and displays a warning. Remove the connection or clear site data to erase saved credentials.
- Keep the public origin on Tailscale HTTPS and restrict access with your Tailnet ACLs. Do not expose port 8888 or the Hermes Bot port directly to the public internet.
- Never commit `.aiot`, `.env`, logs, attachments, screenshots, browser data, or a real connection key.

### Troubleshooting

- **The Tailscale page opens but profiles do not appear:** check that the same key is configured in Hermes Bot and AIOT, then confirm Hermes Bot is running.
- **Setup cannot find the original Hermes destination:** restore the Tailscale Serve root mapping so it points to Hermes Bot, then run local setup again.
- **Port 8888 is unavailable:** stop the other local service or launch AIOT with another `AIOT_LOCAL_PORT`; update the Tailscale mapping through the setup flow afterward.
- **View the startup log:** open `.aiot/aiot.log` inside the project directory.

### Approvals and notifications

While AIOT is visible, that device uses in-app unread indicators instead of system notifications. Background devices still receive push. Foreground presence renews every 5 seconds and expires after 15 seconds; an abrupt browser crash or lost connection can delay restoration of background delivery by up to 15 seconds. A push already in transit can race with opening the app, and browser-enforced generic notifications cannot be fully controlled.

Approval choices are supplied by Hermes; AIOT does not invent session or permanent permission. Only requests actually sent by Hermes appear as approval cards. Resolved or rejected cards remain visible for 30 seconds and then collapse; stale 409 responses are removed instead of returning to a false waiting state. Task planning and scheduled-job cards are not included in v0.1.3 because Hermes Bot does not currently expose structured task-list state. Enable notifications in Settings and accept the browser permission prompt, then send a test notification. Keep AIOT and Hermes running for background delivery; the notification relay also needs internet access to the browser push provider.

Automated CI checks are not a fresh macOS installation test. Windows and iPhone installation have not been validated.

![English mobile chat preview](docs/images/mobile-chat-en.png)

---

## 繁體中文

![AIOT 繁體中文示範介面](docs/images/v0.1.2-zh.svg)

![繁體中文批准卡設計預覽](docs/images/approval-zh.svg)

此圖是使用虛構內容的 UI 示意圖，不是實際對話截圖，也不代表後端執行證據。

### 三個服務各自做什麼

- **Hermes Bot 服務**在你的電腦上執行，負責 profile、對話、模型工作、檔案與批准流程。
- **AIOT 本機服務**位於 `http://127.0.0.1:8888`，負責提供 PWA 頁面，並把 `/api/bot` 請求轉送到現有的本機 Hermes Bot。
- **Tailscale HTTPS 網址**是手機實際開啟的私人網址。完成設定後，同一個網址會顯示 AIOT，Bot 請求則由 AIOT 在電腦內部轉送給 Hermes。

AIOT 本身不含模型，也不會取代 Hermes。AIOT 不會寫死 profile 清單或 Hermes 的本機連接埠。

### 使用前準備

1. macOS 12 或更新版本。v0.1.3 已在 macOS 與 Android Chrome／PWA 驗證；Windows 與 iPhone 安裝尚未驗證。
2. 安裝 [Node.js](https://nodejs.org/) 22.12 或更新版本。
3. 電腦與手機都已安裝並登入 [Tailscale](https://tailscale.com/download)。電腦的 PATH 必須找得到 `tailscale` 指令，且可執行 `tailscale serve status --json`。
4. Hermes Bot 已啟用 `/api/bot` 的 profile、訊息、事件、附件、動態選單、中止與批准功能。Hermes 0.21.x profile 若提供官方 Runs、Skills、批准及停止介面，AIOT 會自動偵測；沒有提供的 profile 仍沿用既有 Bot 傳輸路徑。
5. 先準備一個 Tailscale Serve HTTPS 網址，並讓它目前指向本機 Hermes Bot 服務。AIOT 設定時會解析這個既有映射，因此不必在 AIOT 寫死 Hermes 的 port。

一般模型 API 或 Hermes Session 網頁並不等於 Bot API。你的 Hermes 必須已提供上述 Bot adapter 路由；AIOT 不會安裝該 adapter，也不會修改 Hermes 設定。Serve 目的地必須是同一台電腦上的 loopback HTTP 服務。

### 產生連線金鑰

若 Bot adapter 已有連線金鑰，直接使用現有金鑰。否則在執行 Hermes 的電腦上產生至少 32 字元的隨機金鑰：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

把產生的內容填入 Hermes Bot 的 PWA／瀏覽器平台 `connection_key` 設定，再透過 Hermes 原本的 App 流程重新啟動 Hermes，讓 Bot 端點採用新金鑰。這是 AIOT 連接 Hermes 的金鑰，並不是模型供應商的 API Key，請勿公開。

### macOS 安裝與連線

1. 下載並解壓縮這個專案。
2. 確認 Hermes Bot 正在執行，而且 Tailscale HTTPS 網址目前已能到達 Hermes Bot。
3. 雙擊 **AIOT.app**。第一次開啟若被 macOS 阻擋，請對 App 按右鍵並選擇 **打開**。
4. AIOT 會在需要時安裝 JavaScript 套件、建立 PWA、把 AIOT 本機服務啟動在 `127.0.0.1:8888`，並自動打開設定頁；不需要留著 Terminal 視窗。
5. 輸入完整的 Tailscale HTTPS 網址；若網址有 port 必須保留，例如 `https://your-machine.example.ts.net:10000`，網址後面不要加路徑。
6. 輸入前一步產生的連線金鑰，按下 **連接 Hermes**。
7. AIOT 會先驗證金鑰、從 Tailscale Serve 找到原本的本機 Hermes Bot 位置，再把同一個 HTTPS 網址改成由 8888 提供 AIOT；瀏覽器會自動轉到該 Tailscale 網址。
8. 確認牛馬清單出現，選一個非關鍵 profile，傳送一段唯一的測試文字並確認收到回覆。
9. Android 用 Chrome 安裝 PWA；iPhone 用 Safari 的「加入主畫面」。

再次雙擊 **AIOT.app** 只會打開已在執行的服務。雙擊 **Stop AIOT.app** 可停止背景 AIOT 服務。啟動或停止 AIOT 都不會重新啟動 Hermes。

### 本機資料與安全性

- `.aiot/runtime.json` 只保存自動解析出的本機 Hermes Bot 目的地，不保存瀏覽器連線金鑰。
- 啟用通知後，`.aiot/push-private.json` 會以 AES-256-GCM 密文保存推播私鑰、Hermes 驗證憑證、訂閱與投遞狀態。macOS 會把加密金鑰保存在登入鑰匙圈；鑰匙圈不可用時，AIOT 才使用另一個權限為 0600 的本機金鑰檔。這些都是不可分享的本機私人資料。
- `.aiot/aiot.log` 與 `.aiot/aiot.pid` 屬於本機 AIOT 服務；整個 `.aiot` 資料夾都已排除在 Git 之外。
- 瀏覽器會依 HTTPS 網址保存連線金鑰，讓安裝後的 PWA 重新開啟時仍可連線。要清除時，請在 AIOT 移除連線或清除該網站的瀏覽資料。
- 外部網址只使用 Tailscale HTTPS，並用 Tailnet ACL 限制可連線的裝置。不要把 8888 或 Hermes Bot port 直接公開到網際網路。
- 請勿提交 `.aiot`、`.env`、日誌、附件、截圖、瀏覽器資料或真實連線金鑰。

### 常見問題

- **Tailscale 頁面打得開，但看不到 profile：**確認 Hermes Bot 與 AIOT 使用同一把金鑰，並確認 Hermes Bot 還在執行。
- **設定頁找不到原本的 Hermes 位置：**先把 Tailscale Serve 根路徑恢復成指向 Hermes Bot，再重新執行 AIOT 本機設定。
- **8888 已被占用：**停止占用它的本機服務，或用其他 `AIOT_LOCAL_PORT` 啟動，再透過設定流程更新 Tailscale 映射。
- **查看啟動紀錄：**打開專案內的 `.aiot/aiot.log`。

### 批准與通知

AIOT 在前景時，該裝置改用介面內的新訊息提示，不顯示系統通知；其他背景裝置仍接收推播。前景狀態每 5 秒更新，15 秒後失效；瀏覽器突然關閉或斷線時，背景投遞最多可能延後 15 秒恢復。已在傳送途中的推播可能與開啟 App 同時抵達，瀏覽器強制顯示的一般通知無法完全控制。

批准選項來自 Hermes；AIOT 不會自行加入整個對話或永久批准權限。只有 Hermes 真正送出的要求會顯示批准卡。批准或拒絕後保留 30 秒再淡出收合；已在其他地方處理而回傳 409 的舊卡會直接移除，不再假裝等待批准。v0.1.3 不包含任務規劃或排程工作卡，因為 Hermes Bot 目前沒有提供結構化任務清單狀態。到設定啟用通知並接受瀏覽器權限，再發送測試通知；背景通知需要 AIOT 與 Hermes 持續執行，且 AIOT 能連上瀏覽器的網際網路推播服務。

CI 自動檢查不等於全新 macOS 安裝驗證。Windows 與 iPhone 安裝流程尚未實測。

![繁體中文桌面對話預覽](docs/images/desktop-chat-zh.png)
![繁體中文牛馬清單預覽](docs/images/mobile-roster-zh.png)

## License

[MIT](LICENSE)

### 手機端金鑰保存 / Browser credential storage

手機連線金鑰使用 AES-256-GCM 加密後保存在 IndexedDB，搭配不可直接匯出的 Web Crypto 金鑰與網址綁定驗證。舊版 localStorage／sessionStorage 明文會遷移清除。加密儲存不可用時僅在記憶體使用並提示，不退回明文保存。此方式不是硬體安全區保證，也不能抵擋同站 XSS 或遭入侵的瀏覽器。

主機通知服務的 `.aiot/push-private.json` 已使用 AES-256-GCM 加密並設為 0600；macOS 優先把加密金鑰放在登入鑰匙圈。若系統鑰匙圈不可用，旁邊的 `push-state.key` 會以 0600 保存，因此仍建議啟用主機磁碟加密並限制帳號存取。整個 `.aiot` 目錄不包含在 GitHub 提交中。

See [0.1.3 release notes / 更新內容](CHANGELOG.md).
