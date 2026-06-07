- [x] Inspect current Exporter.ts structure and identify broken function splice
- [ ] Reconstruct exportTimelineToMp4 browser WebCodecs+mp4-muxer implementation so it is a complete function
- [ ] Remove orphaned WebCodecs code from exportTimelineToTauriMp4 (ensure it ends right after FFmpeg invoke)
- [ ] Add any missing constants/types (FRAMES_PER_BATCH, AUDIO_FRAME_SIZE, quality bitrates, interfaces) used by exportTimelineToMp4
- [ ] Ensure helper functions remain in correct scope
- [ ] Run TypeScript build (npm run build) to confirm compilation
- [ ] Smoke test: trigger export in Tauri to confirm native path works

