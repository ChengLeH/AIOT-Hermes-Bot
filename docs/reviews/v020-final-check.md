# V0.2.0 validation / 驗證紀錄

## Checked / 已檢查

- 166 frontend tests and 115 backend tests passed; TypeScript and production build passed. ESLint has zero errors and 16 existing hook/dependency warnings.
- Browser ciphertext migration preserves source data until encryption succeeds, blocks overwrites after failed reads, and uses nonextractable AES-GCM keys.
- Session owner/profile/parent isolation, official authentication, bounded timeout retrieval, bounded completed-task references, attachment rollback and durable retry failures have targeted regressions.
- A direct security review identified unsent-reply false success and staged-image retry problems. Both were corrected with persistence-failure and restart regressions.
- Real Android AIOT reloaded with login/history retained; old plaintext desk/session cache entries were absent. Synthetic English and Traditional Chinese task UI previews have no horizontal overflow at 390 CSS pixels.
- Earlier real Session reply and approval-notification checks were completed; the user confirmed receiving and opening the Android approval notification. No fresh model or approval action was executed for the final visual polish.

前端 166 項、後端 115 項測試通過；型別檢查與建置通過。ESLint 零錯誤，仍有 16 項既有 hooks／依賴警告。加密遷移、失敗覆寫保護、Session 隔離、批准期限讀取、結果摘錄、附件清理與重試均有對應檢查。安卓實際重新載入後登入及歷史保留，舊明文快取已移除；中英文虛構預覽在 390 CSS 像素下未水平溢出。

## Limits / 限制

This is not penetration-test certification. Same-origin malicious scripts can access an unlocked application's memory. Legacy Bot transports lack a supported result-context injection field. Configured approval duration is not an exact reconstructed deadline. Windows/iPhone installation and a fresh installation on another computer remain unverified.

Code review: skipped (ce-code-review unavailable) — the full reviewer dispatch was hard-capped. A direct manual security/lifecycle review and failure-injection tests were performed instead; no full independent cross-model review is claimed. Reuse/quality/efficiency passes retained shared composer controls, bounded caches and separate trust checks; no safety guards were removed for simplification.

本次不是滲透測試認證；同站惡意程式仍能讀取解鎖中的記憶體。舊 Bot 路徑不能注入任務摘錄，批准設定秒數不等於重建出的精確截止時間。尚未完成 Windows／iPhone 或另一台全新電腦的安裝驗證。完整跨模型審查因工具名額上限未完成，已另做直接安全／生命週期檢查與故障注入測試，不宣稱完整獨立審查通過。

## Post-deploy validation / 部署後檢查

Check local AIOT availability, retained sign-in/history, task detail/search, notification delivery and stop/delete outcomes. A sustained connection failure, lost state or repeated unsent-reply error is a rollback trigger: stop AIOT and restore the prior application source while retaining encrypted state and its original keys. Never delete private state to hide an error. Hermes is not restarted by this release.

部署後確認 AIOT 可連線、登入／歷史保留、任務及搜尋正常。若持續斷線、資料遺失或重複出現未送出錯誤，停止 AIOT 並恢復前版程式，保留密文與原金鑰，不以刪除資料掩蓋錯誤。本次不重啟 Hermes。
