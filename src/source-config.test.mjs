import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ARXIV_MAX_RESULTS,
  DEFAULT_ARXIV_QUERY,
  DEFAULT_QIITA_MAX_RESULTS,
  DEFAULT_WIKIPEDIA_MAX_RESULTS,
  DEFAULT_YOUTUBE_MAX_RESULTS,
  DEFAULT_ZENN_MAX_RESULTS,
  normalizeYouTubeChannelInput,
  readQuerySourceConfig,
  readWikipediaConfig,
  readYouTubeConfig,
  readZennConfig,
} from "./source-config.ts";

test("glanceable source defaults stay aligned in the frontend", () => {
  assert.equal(DEFAULT_ARXIV_MAX_RESULTS, 3);
  assert.equal(DEFAULT_WIKIPEDIA_MAX_RESULTS, 3);
  assert.equal(DEFAULT_QIITA_MAX_RESULTS, 3);
  assert.equal(DEFAULT_ZENN_MAX_RESULTS, 3);
  assert.equal(DEFAULT_YOUTUBE_MAX_RESULTS, 1);
});

test("query config uses defaults for sparse or invalid JSON and preserves explicit values", () => {
  assert.deepEqual(readQuerySourceConfig("{}", DEFAULT_ARXIV_QUERY, DEFAULT_ARXIV_MAX_RESULTS), {
    query: "cat:cs.AI",
    maxResults: 3,
  });
  assert.deepEqual(readQuerySourceConfig("not json", "fallback", 3), {
    query: "fallback",
    maxResults: 3,
  });
  assert.deepEqual(readQuerySourceConfig('{"query":"tag:Rust","maxResults":7}', "", 3), {
    query: "tag:Rust",
    maxResults: 7,
  });
});

test("typed source readers use sparse defaults without hiding explicit counts", () => {
  assert.deepEqual(readWikipediaConfig("{}"), { language: "ja", maxResults: 3 });
  assert.deepEqual(readZennConfig("{}"), { feedType: "trend", value: "", maxResults: 3 });
  assert.deepEqual(readYouTubeConfig("{}"), { channel: "", maxResults: 1 });
  assert.equal(readWikipediaConfig('{"maxResults":9}').maxResults, 9);
  assert.equal(readZennConfig('{"feedType":"user","value":"nasu","maxResults":8}').maxResults, 8);
  assert.equal(readYouTubeConfig('{"channel":"@example","maxResults":4}').maxResults, 4);
  assert.equal(
    readYouTubeConfig('{"channelId":"UC123456789012345678","maxResults":4}').channel,
    "UC123456789012345678",
  );
});

test("YouTube channel input accepts handles and ordinary channel URLs", () => {
  const id = "UC123456789012345678";
  assert.equal(normalizeYouTubeChannelInput(id), id);
  assert.equal(normalizeYouTubeChannelInput(`https://www.youtube.com/channel/${id}`), id);
  assert.equal(normalizeYouTubeChannelInput(`https://youtube.com/channel/${id}/videos`), id);
  assert.equal(normalizeYouTubeChannelInput("@YouTubeCreators"), "@youtubecreators");
  assert.equal(
    normalizeYouTubeChannelInput("https://www.youtube.com/@YouTubeCreators/videos"),
    "@youtubecreators",
  );
  assert.equal(
    normalizeYouTubeChannelInput("youtube.com/c/YouTubeCreators"),
    "https://www.youtube.com/c/YouTubeCreators",
  );
  assert.equal(normalizeYouTubeChannelInput("not-a-channel"), null);
});
