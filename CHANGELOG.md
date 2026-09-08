# Changelog / 更新內容

## 0.1.3

### English

- Detect Hermes 0.21.x official profile capabilities locally and use official Runs plus SSE for supported text-only Bot turns. Profiles without the new interface continue through the existing Bot transport; attachments remain on the Bot upload path.
- Load `/` suggestions from the official profile Skills API and merge them with existing Bot completions without duplicates.
- Map official tool activity, approvals, stop controls, and terminal run state into the existing AIOT working indicator, approval card, interrupt control, transcript, and notification relay. AIOT still does not invent task-list cards when Hermes supplies no structured task state.
- Resolve approval conflicts consistently: both approve and reject actions dismiss stale 409 cards, while confirmed approved or rejected cards keep the 30-second fade-and-collapse behavior.
- Encrypt host-side notification state with AES-256-GCM. macOS stores the state key in Login Keychain; a mode-0600 local key is used only when Keychain is unavailable. Existing v0.1.2 plaintext private state migrates on the next save.
- Keep the official Hermes `API_SERVER_KEY` inside the local AIOT process. The browser and phone continue using only their configured Bot connection key, and no user host, key, profile, conversation, attachment, log, or `.aiot` runtime file is included in the release.

Validation: frontend tests, Node service tests, type checking, production build, secret scan, tracked-file inventory, and the existing macOS/Android AIOT UI flow. Windows and iPhone installation remain unverified.

### 繁體中文

- 在本機自動偵測 Hermes 0.21.x 各 profile 的官方能力；支援的純文字 Bot 回合改用官方 Runs 與 SSE，沒有新介面的 profile 仍沿用既有 Bot 傳輸，附件繼續走原本的 Bot 上傳路徑。
- `/` 動態選單會讀取官方 profile Skills API，並與既有 Bot 補全合併及去除重複項目。
- 把官方工具活動、批准、停止與回合結束狀態映射到 AIOT 現有的工作中動畫、批准卡、停止鍵、對話與通知轉送。Hermes 沒有提供結構化任務狀態時，AIOT 仍不會虛構任務清單卡。
- 統一處理批准衝突：接受或拒絕遇到已被處理的 409 舊卡都會移除；真正批准或拒絕成功的卡片維持 30 秒後淡出收合。
- 電腦端通知狀態改用 AES-256-GCM 加密。macOS 把狀態金鑰存入登入鑰匙圈；鑰匙圈不可用時才使用權限為 0600 的本機金鑰。v0.1.2 的舊明文私人狀態會在下一次保存時遷移。
- Hermes 官方 `API_SERVER_KEY` 只留在 AIOT 本機程序；瀏覽器與手機仍只使用自己設定的 Bot 連線金鑰。發佈內容不包含任何使用者主機、金鑰、profile、對話、附件、日誌或 `.aiot` 執行資料。

驗證範圍：前端測試、Node 服務測試、型別檢查、正式建置、機密掃描、追蹤檔案盤點，以及既有 macOS／Android AIOT 介面流程。Windows 與 iPhone 安裝仍未驗證。

## 0.1.2

### English

- Dismiss both approved and rejected cards after 30 seconds with the same fade-and-collapse animation. Make stop controls a clearer muted red and tighten preview unread badges.

- Make message copy icons smaller than the text and place them inside the bottom-right corner, with reserved space to prevent overlap.

- Show a muted blue-gray glowing **New message** badge beside Bots with unread replies; opening their conversation clears it. Preserve unread state across reloads and detect changed replies while catching up on saved history.
- Suppress system notifications on the device where AIOT is visible, while retaining background notifications on other devices.
- Includes the previous reply-notification, dynamic command trigger and historical typing fixes.
- Known limitation: enabled profile-local H3 / Host Bridge skills may be absent from the Hermes Bot completion API. This release does not claim to fix that upstream catalog issue or change Hermes settings.

### 繁體中文

- 已批准與已拒絕卡皆在 30 秒後淡出收合；停止鍵改為更明確的灰紅色，預覽圖未讀標籤縮小貼合文字。

- 複製圖示縮小至比內文字體小，放在氣泡內右下角並預留空間，不再額外占用下方一行。

- 未讀 Bot 名稱旁顯示灰藍色光暈的「新訊息」標籤；進入對話後清除。保留重新開啟前的未讀狀態，並在歷史同步時辨識已儲存回覆的變更。
- AIOT 在目前裝置前景時抑制系統通知，其他裝置的背景通知仍保留。
- 包含先前的實際回覆通知、動態指令觸發及歷史事件造成假輸入中的修正。
- 已知限制：Hermes Bot 補全 API 可能遺漏已啟用的 profile 本地 H3／Host Bridge skills；本版未宣稱修復此上游清單問題，也未修改 Hermes 設定。

## 0.1.1

### English

- Handle actual Hermes turn-completion events for reply notifications, without duplicate pushes; show dynamic slash/mention suggestions using the complete trigger token.
- Restore historical events without replaying stale typing indicators; publish the current conversation state after catch-up.

- Fix clean installation in CI by restoring the missing locked optional dependency.

- Encrypt browser connection credentials with AES-256-GCM and a non-extractable Web Crypto key in IndexedDB; migrate legacy plaintext storage and use memory-only fallback when encrypted persistence is unavailable. This does not claim protection against same-origin XSS.

- Improve mobile chat wrapping, navigation, syntax-colored code and per-message copy controls. Open each Bot at its latest message and jump to latest after sending; incoming replies preserve your position when you scroll up to read.
- Buffer streamed replies at sentence boundaries inside one bubble per message, with a short arrival animation; keep Markdown blocks intact and flush unfinished text when the turn ends.
- Keep genuine Hermes approval cards with server-provided permission choices, muted status colors, collapsible details and request timestamps. Approved cards fade away after 30 seconds. Unknown server timeouts are shown as unavailable.
- Restore the working indicator and give discovered Bots distinct muted eye colors.
- Add an AIOT-owned Web Push relay that resumes subscriptions when AIOT restarts. Notifications contain generic notices rather than chat or command contents.
- Remove task/workflow cards: the current Bot API does not expose structured todo or scheduled-job state.
- Add English and Traditional Chinese installation guidance, matching-language synthetic approval previews, and CI checks.

Validation: local macOS and Android checks; Windows and iPhone installation remain unverified. Real reply notifications and mobile command suggestions were verified on Android. Background approval notifications still need further end-to-end checks.

### 繁體中文

- 支援 Hermes 真正的回合完成事件以發送回覆通知，避免重複推送；保留完整觸發符號以顯示動態斜線與提及選單。
- 還原歷史事件時不再重播舊的正在輸入狀態，同步完成後才顯示目前對話的工作狀態。

- 補齊遺漏的選用依賴鎖定資料，修正 CI 乾淨安裝失敗。

- 手機連線憑證改用 AES-256-GCM 與不可直接匯出的 Web Crypto 金鑰保存在 IndexedDB；遷移舊明文，無法加密保存時僅使用記憶體並提示。此機制不宣稱能防禦同站 XSS。

- 改善手機聊天換行、返回操作、程式碼語法配色，新增每則訊息的複製按鈕。進入各 Bot 或送出訊息時定位最新訊息；Bot 回覆時不打斷主動往上閱讀的位置。
- 串流回覆先累積成完整句子再顯示，同一則回覆維持同一顆氣泡與進場動畫；Markdown 區塊保持完整，回合結束時顯示剩餘文字。
- 保留真正由 Hermes 發出的批准卡，權限選項依後端提供；加入灰調狀態色、可收合內容與送出時間。已批准卡保留 30 秒後淡出；未提供的逾時資訊如實標示。
- 恢復工作中動畫，動態發現的 Bot 使用不同灰調眼睛顏色。
- 新增由 AIOT 運行的 Web Push 轉送服務，重啟後自動恢復訂閱；通知使用一般提醒，不含聊天或指令內容。
- 移除工作／任務卡：目前 Bot API 未提供結構化待辦或排程工作狀態。
- 補上中英文安裝說明、對應語言的虛構批准卡示意圖與 CI 檢查。

驗證範圍：本機 macOS 與 Android；Windows、iPhone 安裝仍未驗證。Android 已驗證實際回覆通知與手機指令選單；批准的背景通知仍需進一步端到端測試。
