-- =========================================================================
-- CivicSays — 0007_video_hosts.sql
-- Loosens the video_link CHECK to accept more platforms. Idempotent.
--
-- 0006 originally accepted only YouTube + Vimeo. We now accept links from:
--   - YouTube    (youtube.com, youtu.be)
--   - Vimeo      (vimeo.com)
--   - TikTok     (tiktok.com)
--   - Google Drive (drive.google.com)        -- highlight for Filipino users
--   - Facebook   (facebook.com, fb.watch)
--   - X / Twitter (x.com, twitter.com)
--
-- Note: the input allowlist and the embed allowlist are different. The form
-- accepts links from all 6 platforms, but the ticket detail view (Phase 4)
-- will only IFRAME-embed YouTube, Vimeo, TikTok, and Google Drive. Facebook
-- and X are shown as a clickable link to avoid loading their tracking iframes.
-- =========================================================================

alter table public.tickets
  drop constraint if exists tickets_video_link_check;
alter table public.tickets
  add constraint tickets_video_link_check
  check (
    video_link is null
    or video_link ~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|drive\.google\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)/'
  );
