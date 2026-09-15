-- ============================================================
-- TRM 教學網站「技能遊戲」排行榜資料表
-- Supabase 專案：2026 Simulation_qualitative_feedback（fgufsfvrfkvixqpirtol, ap-southeast-1）
--
-- 來源：2026-05 建立時實際執行的 SQL（取自當時工作紀錄）。
-- 2026-09-16 整理時該專案處於 INACTIVE（免費方案閒置自動暫停），
-- 無法連線核對線上結構；若日後喚醒，請以線上實際結構為準。
--
-- 現況：2026-08-08（commit 3cb52f1）「技能遊戲」分頁已改為「擬真圖書館」，
-- 遊戲畫面元素已移除，index.html 中 dbInsert/dbSelect/dbDeleteAll 等
-- 排行榜函式已無任何入口可觸發（死碼）。
-- ============================================================

-- 1. 建表
CREATE TABLE trm_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nickname TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL DEFAULT 12,
  percentage INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 後續新增：完成時間（排行榜同分時以秒數排序）
ALTER TABLE trm_scores ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 9999;

-- 3. 資料列層級權限
ALTER TABLE trm_scores ENABLE ROW LEVEL SECURITY;

-- 任何人可以新增分數（課堂參與者）
CREATE POLICY "anyone can insert" ON trm_scores
  FOR INSERT WITH CHECK (true);

-- 任何人可以讀取排行榜
CREATE POLICY "anyone can read" ON trm_scores
  FOR SELECT USING (true);

-- 任何人可以刪除（讓老師可以清空排行榜）
-- ⚠ 注意：anon key 公開在 index.html 中，等於任何人都能清空整張表。
--   若重新啟用排行榜，建議移除此政策，改由有權限的管理端清除。
CREATE POLICY "anyone can delete" ON trm_scores
  FOR DELETE USING (true);
