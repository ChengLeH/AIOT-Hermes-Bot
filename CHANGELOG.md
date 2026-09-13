# Changelog

## 0.2.3

### English

- Queue files and images for an active Session turn, encrypt their bytes with the existing task state, and stage them only when their own queued turn starts. Public task responses expose metadata only, and the total queued attachment payload is capped at 25 MiB.
- Let users select Bot attachments while work is active; attachments continue through the existing default Fork task route instead of being sent into a busy Bot turn.
- Preserve the host-side Bot history reset marker across encrypted service restarts so an older device cannot restore messages cleared from another device.
- Refuse to take port 8888 from an unrelated process. The launcher reclaims it only when the listener is positively identified as an AIOT server, including an older AIOT checkout.
- Add an optional macOS login service that starts AIOT without placing connection keys in the LaunchAgent file.
- Replace the partial v0.2.2 README imagery with current fictional-data previews covering Contacts, Bot chat, task queue, Fork context, Session detail, schedules, approvals, and artifacts in English and Traditional Chinese.

Validation and platform claims are recorded in the [v0.2.3 release notes](docs/releases/v0.2.3.md).

### 繁體中文

- Session 執行中仍可把檔案與圖片排入下一輪；附件內容沿用任務狀態加密，等自己的佇列輪次開始才暫存到 Hermes。公開任務回應只包含附件資訊，整批待送附件上限為 25 MiB。
- Bot 執行中仍可選擇附件；附件沿用既有的預設 Fork 任務路徑，不會硬塞進正在執行的 Bot 輪次。
- 主機端加密服務重啟後仍保留 Bot 歷史清除時間，避免較舊裝置把已在其他裝置清除的訊息帶回來。
- 8888 被其他程式占用時拒絕搶占；只有確認監聽者是 AIOT，包括舊版 AIOT 工作目錄，啟動程式才會安全接手。
- 新增可選用的 macOS 登入服務，LaunchAgent 不保存連線金鑰。
- README 改用目前版本與虛構資料重新產生的完整預覽，涵蓋聯絡人、Bot 對話、任務佇列、Fork 脈絡、Session 詳情、排程、批准與附件，並提供英文及繁體中文畫面。

驗證範圍與平台聲明記錄於 [v0.2.3 版本說明](docs/releases/v0.2.3.md)。

## 0.2.2

### English




- Keep a Bot conversation browsable while only the latest 7 messages stay in the encrypted save, the startup replay window, and native-run conversation_history.
- Show the Hermes-transformed Traditional reply in Bot chat; do not stream pre-conversion Simplified text, and do not import a duplicate Simplified assistant from session history when a native reply already landed.
- Leave unfinished local pending bubbles as ended history on restart, and stop leftover queue dispatch on GET.
- Slow Bot event polling to 2s in the foreground, pause it while hidden, refresh on return; history catch-up 60s; native queue 5s only while sending or queued. Session polling unchanged.
- Start a fresh PWA opening at Contacts, preserve active tasks across transient polling failures, and prevent duplicate back-navigation entries.
- Use a shared 280 ms card transition for Bot and Session navigation; keep the page mounted until its exit animation completes.
- Bound supplementary artifact scans to one deadline, including authentication refresh and response reads; clear deleted-task client and retry references.
- Keep scheduled-job availability stable across temporary probe failures and show an explicit retrying state when the Jobs endpoint is unavailable.
- Tighten same-origin checks for Session routes and disable HTTP caching of entry HTML across hashed-asset deployments.
- Remove Hermes request abort listeners after completion, and let optional notification sources fail without blocking browser notification enrollment.
- Add portrait PWA orientation and refine mobile navigation, safe-area handling, schedule controls, and task workspace layout.




Local validation: 356 automated tests, type checking, zero-warning lint, production build, and the browser regression (including intermediate card movement) passed. Synthetic WebKit and Chrome checks also pass the history-isolation and animation-guard regressions. These checks do not establish a real-device fix: on a real iPhone, the user reports a conversation jump followed by a white unstyled screen with an oversized logo when a completed Session syncs back to the Bot. Completion summaries now update in a single deduplicated batch, but real-device acceptance is still required. iPhone acceptance remains open. Installed mobile builds retry the native portrait lock; unsupported platforms receive a portrait-only fallback overlay. The manifest and native lock are best-effort platform behavior, not a universal OS lock. GitHub CI covers source boundaries, clean install, static checks, automated suites, build, and isolated Chromium browser regression, but not live Hermes behavior, live notification delivery, iPhone, Windows, or fresh Linux installation. iPhone download-return layout recovery remains pending.




### 繁體中文




- Bot 對話仍可往上滑瀏覽完整歷史；加密存檔、啟動重放與 native-run 模型上下文每次只保留最近 7 則。
- 畫面只顯示 Hermes 轉換後的繁體回覆；不再貼出轉換前簡體串流，也不把 session 歷史簡體回覆再插成第二則。
- 重開後 pending 留在原位當已結束，不再重送；輪詢 queue 不再執行卡住的舊請求。
- 前景事件 2 秒、背景暫停、回前景立刻補打；歷史 60 秒；queue 僅送出或排隊時 5 秒一次。Session 輪詢不變。
- PWA 重新開啟時回到聯絡人；暫時輪詢失敗時保留目前任務，並修正重複返回紀錄。
- Bot 與 Session 共用 280 毫秒卡片轉場，等待退出動畫完成再卸載頁面。
- 附件補充掃描、登入更新與回應讀取共用整體期限；已確認刪除的任務會清除連線參照與重試狀態。
- 排程端點暫時探測失敗時維持既有可用狀態；Jobs 無法使用時顯示明確的重試提示。
- 加強 Session 路由同源檢查，停用入口 HTML 的 HTTP 快取，降低更新後沿用舊資產參照的風險。
- Hermes 請求結束後清理中止監聽器；選用通知來源失敗時，不阻塞瀏覽器通知註冊。
- 新增直向 PWA 方向設定，並調整手機導覽、安全區域、排程控制與任務工作區版面。




本機驗證：356 項自動測試、型別檢查、零警告 lint、正式建置及含卡片中途位移的瀏覽器回歸測試皆通過。合成 WebKit 與 Chrome 檢查也通過 history isolation 及 animation guard 回歸，但不能證明實機已修好：使用者回報實機 iPhone 在 Session 完成同步回 Bot 時，對話先跳動，再出現白色未套樣式畫面與巨大 Logo。完成摘要已改成單次批次更新與去重，仍需實機驗收；iPhone 驗收仍未完成。已安裝的行動版會重試原生直向鎖定；不支援的平台會顯示僅限直向的覆蓋提示。Manifest 與原生鎖定是盡力的平台行為，不是所有作業系統都能強制鎖定直向。GitHub CI 涵蓋來源邊界、乾淨安裝、靜態檢查、自動化測試、建置及隔離的 Chromium 瀏覽器回歸，但不涵蓋真實 Hermes、實機通知投遞、iPhone、Windows 或全新 Linux 安裝驗證。iPhone 關閉下載預覽後的版面恢復仍待驗證。




## 0.2.1




### English




- Queue text turns in FIFO order while a Bot or Session is working. The existing 44 px action button becomes Stop when the composer is empty and Send when text is present; queued attachments remain blocked until the active turn settles.
- Discover downloadable files and images from trusted official Session tool results. AIOT serves them through an authenticated, owner/task/profile-bound endpoint with strict type, size, signature and redirect checks; host paths never become client links.
- Scope in-memory attachment previews to their connection, Bot, conversation or Session task so equal attachment IDs cannot reuse another scope's object URL.
- Wrap completed Session results as untrusted JSON reference data before native parent-Bot context injection. Document the new task ownership scope created when a connection key or target changes.
- Encrypt browser and host task/run/push state with AES-256-GCM, retain fail-closed migrations, and keep foreground notification state out of system push delivery.
- Replace the old template dependency set with the small runtime set actually used by AIOT. `npm test` now runs both frontend and backend suites, CI uses that same command, and lint treats warnings as failures.
- Add one-step macOS, Linux and Windows start/stop launchers. Dashboard sign-in is deferred until the first Session task; ordinary Bot chat keeps the existing URL-and-key setup.
- Recover Chrome Push subscriptions automatically after the server notification key changes, instead of requiring users to clear browser data.
- Mark the parent Bot with the existing blue unread badge when an independent or forked Session finishes.
- Route newly created scheduled-job results through Hermes 0.21.1's official canonical Bot Chat delivery, so the selected Bot receives the result. Delete directly from the compact schedule panel; an active job is paused successfully before its real Hermes Job record is deleted.
- Refine background themes, task controls, seven-message context presentation, timestamps, mobile viewport behavior and disabled pull-to-refresh. Scheduled jobs now use the same simple, immediate accordion behavior as the queue, without the previous cloned-card animation.




Validation for the release candidate includes the full local test/type/lint/build suite plus Android PWA checks for a real Session FIFO turn pair and a real generated-file download. iPhone download-return layout recovery is deferred to the next version. Windows remains unverified; the published Linux flow is validated after release on a separate machine.
