# AIOT / Hermes Bot

**v0.1 · your agent, in your pocket**

AIOT is a mobile-first PWA frontend for a Hermes Bot running on your own computer. It discovers the profiles exposed by Hermes and presents each profile as a contact. Messages, attachments, Markdown, code blocks, approvals, interrupt controls, search, notifications, and downloadable files stay connected to your local Hermes Bot.

> Platform status: v0.1 has been installed and tested on macOS. Windows has not been tested yet.

![AIOT desktop preview](docs/images/desktop-chat-zh.png)

The screenshots use synthetic profiles (`Orion`, `Studio`, and `Sage`). They contain no private Hermes data.

## English

### What runs where

- **Hermes Bot service** runs on your computer and owns profiles, conversations, model work, files, and approvals.
- **AIOT local service** runs at `http://127.0.0.1:8888`. It serves the PWA and forwards only the `/api/bot` traffic to your existing local Hermes Bot endpoint.
- **Tailscale HTTPS URL** is the private address your phone opens. After setup, the same URL serves AIOT while AIOT forwards Bot requests locally.

AIOT does not contain a model and does not replace Hermes. It does not require a fixed profile list or a hard-coded Hermes port.

### Requirements

1. macOS 12 or newer. This is the only platform tested for v0.1.
2. [Node.js](https://nodejs.org/) 22 or newer.
3. [Tailscale](https://tailscale.com/download) installed and signed in on the computer and phone.
4. A working Hermes Bot endpoint with the `/api/bot` profile, message, event, attachment, completion, interrupt, and approval routes enabled.
5. A Tailscale Serve HTTPS origin that currently forwards to the local Hermes Bot service. AIOT reads this existing mapping during setup, so you do not enter or hard-code the local Hermes port in AIOT.

### Create the connection key

Generate a random key of at least 32 characters on the Hermes computer:

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
- `.aiot/aiot.log` and `.aiot/aiot.pid` belong to the local AIOT service. The entire `.aiot` directory is excluded from Git.
- The connection key is stored by the browser for the configured HTTPS origin so the installed PWA can reconnect after a restart. Remove the connection or clear that site's browser data to erase it.
- Keep the public origin on Tailscale HTTPS and restrict access with your Tailnet ACLs. Do not expose port 8888 or the Hermes Bot port directly to the public internet.
- Never commit `.aiot`, `.env`, logs, attachments, screenshots, browser data, or a real connection key.

### Troubleshooting

- **The Tailscale page opens but profiles do not appear:** check that the same key is configured in Hermes Bot and AIOT, then confirm Hermes Bot is running.
- **Setup cannot find the original Hermes destination:** restore the Tailscale Serve root mapping so it points to Hermes Bot, then run local setup again.
- **Port 8888 is unavailable:** stop the other local service or launch AIOT with another `AIOT_LOCAL_PORT`; update the Tailscale mapping through the setup flow afterward.
- **View the startup log:** open `.aiot/aiot.log` inside the project directory.

![AIOT mobile contact list](docs/images/mobile-roster-zh.png)
![AIOT mobile approval card](docs/images/mobile-chat-en.png)

---

## 繁體中文

### 三個服務各自做什麼

- **Hermes Bot 服務**在你的電腦上執行，負責 profile、對話、模型工作、檔案與批准流程。
- **AIOT 本機服務**位於 `http://127.0.0.1:8888`，負責提供 PWA 頁面，並把 `/api/bot` 請求轉送到現有的本機 Hermes Bot。
- **Tailscale HTTPS 網址**是手機實際開啟的私人網址。完成設定後，同一個網址會顯示 AIOT，Bot 請求則由 AIOT 在電腦內部轉送給 Hermes。

AIOT 本身不含模型，也不會取代 Hermes。AIOT 不會寫死 profile 清單或 Hermes 的本機連接埠。

### 使用前準備

1. macOS 12 或更新版本。v0.1 目前只在 macOS 實際驗證，Windows 尚未驗證。
2. 安裝 [Node.js](https://nodejs.org/) 22 或更新版本。
3. 電腦與手機都已安裝並登入 [Tailscale](https://tailscale.com/download)。
4. Hermes Bot 已啟用 `/api/bot` 的 profile、訊息、事件、附件、動態選單、中止與批准功能。
5. 先準備一個 Tailscale Serve HTTPS 網址，並讓它目前指向本機 Hermes Bot 服務。AIOT 設定時會解析這個既有映射，因此不必在 AIOT 寫死 Hermes 的 port。

### 產生連線金鑰

在執行 Hermes 的電腦上產生至少 32 字元的隨機金鑰：

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
- `.aiot/aiot.log` 與 `.aiot/aiot.pid` 屬於本機 AIOT 服務；整個 `.aiot` 資料夾都已排除在 Git 之外。
- 瀏覽器會依 HTTPS 網址保存連線金鑰，讓安裝後的 PWA 重新開啟時仍可連線。要清除時，請在 AIOT 移除連線或清除該網站的瀏覽資料。
- 外部網址只使用 Tailscale HTTPS，並用 Tailnet ACL 限制可連線的裝置。不要把 8888 或 Hermes Bot port 直接公開到網際網路。
- 請勿提交 `.aiot`、`.env`、日誌、附件、截圖、瀏覽器資料或真實連線金鑰。

### 常見問題

- **Tailscale 頁面打得開，但看不到 profile：**確認 Hermes Bot 與 AIOT 使用同一把金鑰，並確認 Hermes Bot 還在執行。
- **設定頁找不到原本的 Hermes 位置：**先把 Tailscale Serve 根路徑恢復成指向 Hermes Bot，再重新執行 AIOT 本機設定。
- **8888 已被占用：**停止占用它的本機服務，或用其他 `AIOT_LOCAL_PORT` 啟動，再透過設定流程更新 Tailscale 映射。
- **查看啟動紀錄：**打開專案內的 `.aiot/aiot.log`。

## License

[MIT](LICENSE)
