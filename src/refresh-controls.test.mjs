import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_AUTO_REFRESH_SECONDS,
  MIN_AUTO_REFRESH_SECONDS,
  formatRefreshInterval,
  normalizeRefreshSeconds,
  readWidgetRefreshConfig,
  refreshMinutesToSeconds,
  secondsToSliderPosition,
  sliderPositionToSeconds,
  sourceAutoRefreshFloorSeconds,
  widgetRefreshConfigJson,
} from "./refresh-controls.ts";

test("source floors match the adapter automatic-refresh limits", () => {
  assert.equal(sourceAutoRefreshFloorSeconds("arxiv"), 24 * 60 * 60);
  assert.equal(sourceAutoRefreshFloorSeconds("wikipedia"), 6 * 60 * 60);
  assert.equal(sourceAutoRefreshFloorSeconds("qiita"), 60 * 60);
  assert.equal(sourceAutoRefreshFloorSeconds("zenn"), 60 * 60);
  assert.equal(sourceAutoRefreshFloorSeconds("youtube"), 60 * 60);
  assert.equal(sourceAutoRefreshFloorSeconds("future"), MIN_AUTO_REFRESH_SECONDS);
});

test("widget refresh config preserves inherit, off, and interval modes", () => {
  assert.deepEqual(readWidgetRefreshConfig("{}"), {
    mode: "inherit",
    autoIntervalSeconds: null,
  });
  assert.deepEqual(readWidgetRefreshConfig('{"mode":"off"}'), {
    mode: "off",
    autoIntervalSeconds: null,
  });
  assert.deepEqual(
    readWidgetRefreshConfig('{"mode":"interval","autoIntervalSeconds":5400}'),
    { mode: "interval", autoIntervalSeconds: 5400 },
  );
  assert.deepEqual(readWidgetRefreshConfig("not-json"), {
    mode: "inherit",
    autoIntervalSeconds: null,
  });
  assert.equal(widgetRefreshConfigJson("inherit", null), "{}");
  assert.equal(widgetRefreshConfigJson("off", null), '{"mode":"off"}');
  assert.equal(
    widgetRefreshConfigJson("interval", 5400),
    '{"mode":"interval","autoIntervalSeconds":5400}',
  );
});

test("slider endpoints preserve OFF and the global interval bounds", () => {
  assert.equal(sliderPositionToSeconds(0), null);
  assert.equal(sliderPositionToSeconds(1), MIN_AUTO_REFRESH_SECONDS);
  assert.equal(sliderPositionToSeconds(100), MAX_AUTO_REFRESH_SECONDS);
  assert.equal(secondsToSliderPosition(null), 0);
  assert.equal(secondsToSliderPosition(MIN_AUTO_REFRESH_SECONDS), 1);
  assert.equal(secondsToSliderPosition(MAX_AUTO_REFRESH_SECONDS), 100);
});

test("typed minutes are minute-granular and source-floor aware", () => {
  assert.equal(refreshMinutesToSeconds(90, 60 * 60), 90 * 60);
  assert.equal(refreshMinutesToSeconds(30, 60 * 60), 60 * 60);
  assert.equal(refreshMinutesToSeconds(60, 6 * 60 * 60), 6 * 60 * 60);
  assert.equal(refreshMinutesToSeconds(2000, 60 * 60), MAX_AUTO_REFRESH_SECONDS);
  assert.equal(normalizeRefreshSeconds(3599, 60 * 60), 60 * 60);
});

test("formatted intervals stay compact and human-readable", () => {
  assert.equal(formatRefreshInterval(null), "OFF");
  assert.equal(formatRefreshInterval(30 * 60), "30 min");
  assert.equal(formatRefreshInterval(90 * 60), "1.5 h");
  assert.equal(formatRefreshInterval(24 * 60 * 60), "24 h");
});
