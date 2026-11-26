# Firmament Breaker

在瀏覽器裡玩的 2D 橫向卷軸動作遊戲，主角是手繪插畫風的 Q 版劍士。使用 Phaser 4、TypeScript、Vite 開發，目前還在初期開發中。

**線上試玩**：https://maxc8763.github.io/firmament-breaker/ （桌機瀏覽器＋鍵盤）

## 在本機執行

需要 Node.js 22.12 以上（建議 26）。

```sh
npm ci                # 安裝依賴
npm run dev           # 開發伺服器，網址會印在終端機
npm run check         # 型別檢查＋單元測試
npm run build         # 正式建置到 dist/
npm run e2e           # 瀏覽器測試（第一次先跑 npx playwright install chromium）
npm run smoke -- <網址> [--sha <commit>]   # 對部署好的網站做冒煙測試
```

`main` 分支的每次更新都會由 GitHub Actions 自動建置並部署到 GitHub Pages。

## 授權

授權尚未決定；在加入 LICENSE 之前，程式與美術都保留所有權利。第三方素材的來源與授權會列在 `assets/LICENSES.csv`。
