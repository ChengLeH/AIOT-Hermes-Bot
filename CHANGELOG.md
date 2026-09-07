# Changelog / 更新內容

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
