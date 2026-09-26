import assert from "node:assert/strict";
import test from "node:test";
import { approximateSegments, buildSrt, cleanText, srtToText } from "../lib/transcription-text.mjs";

test("transcription text cleanup removes unwanted Chinese spacing", () => {
  assert.equal(cleanText("田野 访谈\t 内容"), "田野访谈内容");
});

test("SRT conversion preserves speech and filters known subtitle spam", () => {
  const srt = "1\n00:00:00,000 --> 00:00:01,000\n课堂正文\n\n2\n00:00:01,000 --> 00:00:02,000\n请不吝点赞订阅转发打赏";
  assert.equal(srtToText(srt), "课堂正文\n");
});

test("approximate segments stay inside the source time window", () => {
  const segments = approximateSegments("第一句。第二句。", 60_000, 10_000);
  assert.equal(segments[0].startMs, 60_000);
  assert.equal(segments.at(-1).endMs, 70_000);
  assert.match(buildSrt(segments), /00:01:00,000/);
});
