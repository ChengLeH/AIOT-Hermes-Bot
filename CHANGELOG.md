# Changelog

## 0.2.0

## English

AIOT v0.2.0 brings independent and forked tasks into the same Bot chat interface, using official Hermes Sessions.

- Start an independent task, or fork with up to seven recent Bot messages. Manage only Sessions created by that Bot in AIOT; existing Hermes Sessions are not imported into the task list.
- Continue task conversations with attachments, real stop controls, selection and deletion synchronized with Hermes.
- Bring completion and approval notifications back through the parent Bot. Foreground devices use in-app indicators; background devices receive push.
- Display real Session work plans and approval requests. Approval duration is read from the profile's official configuration when available; no deadline is invented.
- Include bounded completed-task result excerpts in the next parent Bot request on the native Runs route. This does not create an extra model turn or change Hermes storage. Legacy Bot transports without a context field do not support this feature.
- Share attachment/send controls, search glow, navigation and refined separators across Bot and Session screens. Session conversations open at the latest message; sending goes to the bottom, while model replies preserve the reading position.
- Add AES-256-GCM browser history/configuration storage and safe plaintext migration. Unreadable data blocks overwriting instead of silently losing history. Server task, authentication and notification state remains encrypted.
- Fix stale work/approval state, reconnect cleanup, and retry handling when local storage fails before a reply is sent.

**Setup:** Existing Bot connection setup is unchanged. Task features additionally require official Hermes Dashboard sign-in from the local AIOT setup page. Hermes must already expose the required Bot adapter and official Session interfaces; AIOT does not install or modify Hermes.

Tested platform work targets macOS and Android Chrome/PWA. Windows and iPhone installation remain unverified. Encryption at rest does not protect against malicious code running in the same website or a compromised device.

## 繁體中文

AIOT v0.2.0 把獨立任務與 Fork 任務整合進同一個 Bot 聊天介面，透過 Hermes 官方 Session 執行。

- 可開啟獨立任務，或帶入最近最多七則 Bot 訊息建立 Fork。任務清單只管理該 Bot 從 AIOT 建立的 Session，不混入原本的 Hermes Session。
- 任務內可繼續提問、附檔、實際停止執行，並把選取刪除同步到 Hermes。
- 任務完成與批准通知統一由父 Bot 呈現；使用 App 時顯示未讀提示，背景裝置接收系統推播。
- 顯示真實 Session 工作計畫及批准請求；可取得時讀取 profile 官方設定的批准期限，不自行假設秒數或截止時間。
- 原生 Runs 路徑會在下次向父 Bot 提問時帶入有限長度的已完成任務結果摘錄，不額外呼叫模型，也不改 Hermes 資料庫。沒有上下文欄位的舊 Bot 路徑不支援這項功能。
- Bot 與 Session 共用附件／傳送按鈕、搜尋光暈及分隔線風格。進入任務預設到最新訊息；送出後到底部，模型回覆不拉走閱讀位置。
- 瀏覽器歷史與設定加入 AES-256-GCM 加密及安全明文遷移；資料無法解密時阻止覆寫，避免對話遺失。主機端任務、登入及推播資料維持加密。
- 修正過期工作／批准狀態、重連清理，以及訊息尚未送出前儲存失敗的重試處理。

**設定方式：** Bot 原有網址與金鑰設定不變。任務功能另外在本機 AIOT 設定頁完成 Hermes 官方 Dashboard 登入。Hermes 須已提供必要的 Bot 轉接與官方 Session 介面；AIOT 不安裝或修改 Hermes。

目前平台驗證以 macOS 與 Android Chrome／PWA 為主；Windows 與 iPhone 安裝尚未驗證。靜態加密不能抵擋同站惡意程式碼或已遭入侵的裝置。



## 0.1.4

### English

- Restore recent conversation history from the same profile's Hermes Session API before starting a native run. A session ID alone does not restore `/v1/runs` context. History loading errors stop submission and retain the draft rather than silently starting without context.
- Use the latest 500 backend records, projecting user/assistant text only. Raw tool-call envelopes, reasoning and image bytes are not replayed; this is not full multimodal or tool-trace restoration. Histories above 256 Ki characters are rejected rather than silently truncated further.
- Allow Send during attachment uploads: wait for uploads to finish, then submit once with attachment IDs. Failed uploads prevent submission. Repeated Send actions do not create duplicate messages.
- Keep upload feedback pending while the app is hidden, then show the centered animation when visible. Batch feedback remains one outcome per selected batch.
- Verified a two-turn context recall through the AIOT UI using a cloud-backed Bot. Upload timing and failure paths were tested with delayed browser fixtures.
- **Known tool limitation:** profile CLI/Session toolsets and `api_server` toolsets may differ. AIOT reads profile skills but does not enable tools disabled by the API platform or change Hermes configuration. Skill discovery does not prove tool execution availability. Worker Sessions remain a proposal and are not included.

### 繁體中文

- 原生 run 送出前，先從同一 Profile 的 Hermes Session API 取回近期對話。只傳 session ID 不會讓 `/v1/runs` 恢復上下文；歷史讀取失敗時停止送出並保留草稿，不再默默以空白上下文執行。
- 最多使用後端最近 500 筆紀錄，只接續使用者與助手文字；不重播原始工具呼叫結構、推理或圖片位元組，因此不是完整多模態或工具過程還原。文字超過 256 Ki 字元時明確停止，不再暗中裁切。
- 附件上傳中可先按傳送：等待附件完成後攜帶附件 ID 送出一次。上傳失敗不送出，連按傳送不會重複發送。
- App 位於背景時保留上傳提示，回到前景才顯示中央動畫；同一批附件仍只顯示一次結果。
- 已透過 AIOT UI 驗證雲端 Bot 的兩輪上下文回想；上傳時序與失敗情境使用延遲回應的瀏覽器測試驗證。
- **工具限制：**同一 Profile 的 CLI／Session 與 `api_server` 可有不同的工具啟用範圍。AIOT 讀取 Profile 的 Skills，但不會替 API 啟用被停用的工具，也不修改 Hermes 設定。清單看得到不代表能執行。工作 Session 功能仍在規劃，未包含在本版。

## 0.1.3

### UI follow-up / 介面追加更新

- Encrypt native-runs.json with AES-256-GCM using the existing Keychain-backed state-key mechanism (private file-key fallback when unavailable). Migrate legacy plaintext immediately when loading; reject corrupt encrypted snapshots instead of silently replacing them.
- native-runs.json 同步採用 AES-256-GCM 與既有 Keychain 狀態金鑰機制（不可用時使用私有檔案金鑰）；載入時立即遷移舊明文，加密資料損毀時停止讀取而非靜默覆寫。

- Batch upload feedback: one centered animated notice after the final file completes; green expansion for all-success, red squash if any file fails. Remove duplicate avatars on attachment thumbnails.
- Approval notices can be dismissed without granting permission; dismissed requests do not reappear during replay. Confirmed results fade within about five seconds. Unresolved backend rejection failures are not reported as successful decisions.
- Scheduled-job cards use real execution state and endpoint probing, with a dynamic Bot avatar picker, future-time validation and duplicate-submit protection. General task-list cards remain unsupported.
- Restore top-of-list pull-to-refresh, add synchronized white activity-text glow, extend launch display by one second, and localize the known stopped-session notice.
- Supplement idle Bot history from its canonical Session; harden proxy path validation, stream forwarded responses, and clear attachment caches when connection credentials change.
- Validation: automated tests and production builds; selected Android approval dismissal checks. Full scheduled execution, upload-animation and gesture end-to-end acceptance is still pending. Document indexing stays with Hermes; no file.attach migration is claimed.

- 整批附件最後一個處理完才顯示一次中央提示：全部成功為綠色膨脹，任一失敗為紅色壓扁；移除縮圖上重複的頭像。
- 批准提示可收起且不代表授權，事件重播不重新顯示；確認結果後約五秒淡出。後端拒絕送出失敗仍未解決，不會誤報成功。
- 排程卡讀取真實執行狀態，加入動態 Bot 頭像選單、未來時間防呆及防止重複送出；不宣稱支援一般任務清單卡。
- 補回頂端下拉更新、工作文字同步白色掃光、啟動畫面延長一秒，以及已停止提示的中文化。
- 使用同一 Bot 的 Session 補同步；加強轉發路徑檢查、回應串流及切換連線後的附件快取清除。
- 驗證：自動測試與建置，以及部分 Android 批准卡收起檢查；完整排程執行、上傳動畫及手勢的端到端驗收仍待完成。文件索引交給 Hermes，未實作 file.attach 遷移。

### English

- Detect Hermes 0.21.x official profile capabilities locally and use official Runs plus SSE for supported text-only Bot turns. Profiles without the new interface continue through the existing Bot transport; attachments remain on the Bot upload path.
- Load `/` suggestions from the official profile Skills API and merge them with existing Bot completions without duplicates.
- Map official tool activity, approvals, stop controls, and terminal run state into the existing AIOT working indicator, approval card, interrupt control, transcript, and notification relay. AIOT still does not invent task-list cards when Hermes supplies no structured task state.
- Resolve approval conflicts consistently: both approve and reject actions dismiss stale 409 cards, while confirmed approved or rejected cards fade away within approximately five seconds after confirmation.
- Encrypt host-side notification state with AES-256-GCM. macOS stores the state key in Login Keychain; a mode-0600 local key is used only when Keychain is unavailable. Existing v0.1.2 plaintext private state migrates on the next save.
- Keep the official Hermes `API_SERVER_KEY` inside the local AIOT process. The browser and phone continue using only their configured Bot connection key, and no user host, key, profile, conversation, attachment, log, or `.aiot` runtime file is included in the release.

Validation: frontend tests, Node service tests, type checking, production build, secret scan, tracked-file inventory, and the existing macOS/Android AIOT UI flow. Windows and iPhone installation remain unverified.

### 繁體中文

- 在本機自動偵測 Hermes 0.21.x 各 profile 的官方能力；支援的純文字 Bot 回合改用官方 Runs 與 SSE，沒有新介面的 profile 仍沿用既有 Bot 傳輸，附件繼續走原本的 Bot 上傳路徑。
- `/` 動態選單會讀取官方 profile Skills API，並與既有 Bot 補全合併及去除重複項目。
- 把官方工具活動、批准、停止與回合結束狀態映射到 AIOT 現有的工作中動畫、批准卡、停止鍵、對話與通知轉送。Hermes 沒有提供結構化任務狀態時，AIOT 仍不會虛構任務清單卡。
- 統一處理批准衝突：接受或拒絕遇到已被處理的 409 舊卡都會移除；真正批准或拒絕成功的卡片約五秒內淡出。
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
