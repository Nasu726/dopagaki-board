import test from "node:test";
import assert from "node:assert/strict";

import {
  GRID_COLUMNS,
  GRID_ROWS,
  MIN_WIDGET_COLUMNS,
  MIN_WIDGET_ROWS,
  clampGridRect,
  collides,
  findNearestFreeRect,
  isValidGridRect,
  legacyPixelsToGrid,
  overlaps,
  pointToGridCell,
  pointerDeltaToGrid,
  resizeGridRect,
} from "./board-grid.ts";

test("clampGridRect rounds and keeps rectangles inside the logical board", () => {
  assert.deepEqual(
    clampGridRect({ x: -3.4, y: 7.8, width: 20.2, height: 0.2 }),
    { x: 0, y: GRID_ROWS - MIN_WIDGET_ROWS, width: GRID_COLUMNS, height: MIN_WIDGET_ROWS },
  );
});

test("isValidGridRect enforces the 3 by 2 minimum and board bounds", () => {
  assert.equal(MIN_WIDGET_COLUMNS, 3);
  assert.equal(MIN_WIDGET_ROWS, 2);
  assert.equal(isValidGridRect({ x: 0, y: 0, width: 4, height: 3 }), true);
  assert.equal(isValidGridRect({ x: 0.5, y: 0, width: 4, height: 3 }), false);
  assert.equal(isValidGridRect({ x: 10, y: 0, width: 3, height: 3 }), false);
  assert.equal(isValidGridRect({ x: 0, y: 0, width: 2, height: 2 }), false);
  assert.equal(isValidGridRect({ x: 0, y: 0, width: 3, height: 1 }), false);
});

test("overlap and collision treat touching edges as non-overlapping", () => {
  const first = { x: 0, y: 0, width: 3, height: 2 };
  const touching = { x: 3, y: 0, width: 3, height: 2 };
  const overlapping = { x: 2, y: 1, width: 3, height: 2 };

  assert.equal(overlaps(first, touching), false);
  assert.equal(overlaps(first, overlapping), true);
  assert.equal(collides(first, [touching]), false);
  assert.equal(collides(first, [touching, overlapping]), true);
});

test("findNearestFreeRect uses deterministic placement and never shrinks below 3 by 2", () => {
  assert.deepEqual(
    findNearestFreeRect(
      { x: 0, y: 0, width: 3, height: 2 },
      [{ x: 0, y: 0, width: 3, height: 2 }],
    ),
    { x: 0, y: 2, width: 3, height: 2 },
  );

  const leftNineColumns = [{ x: 0, y: 0, width: 9, height: GRID_ROWS }];
  assert.deepEqual(
    findNearestFreeRect({ x: 0, y: 0, width: 4, height: 3 }, leftNineColumns),
    { x: 9, y: 0, width: 3, height: 3 },
  );

  assert.equal(
    findNearestFreeRect(
      { x: 0, y: 0, width: 4, height: 3 },
      [{ x: 0, y: 0, width: GRID_COLUMNS, height: GRID_ROWS }],
    ),
    null,
  );
});

test("resizeGridRect respects board and minimum-size bounds", () => {
  const initial = { x: 2, y: 2, width: 4, height: 3 };
  assert.deepEqual(resizeGridRect(initial, "nw", -10, -10), {
    x: 0,
    y: 0,
    width: 6,
    height: 5,
  });
  assert.deepEqual(resizeGridRect(initial, "se", 20, 20), {
    x: 2,
    y: 2,
    width: GRID_COLUMNS - 2,
    height: GRID_ROWS - 2,
  });
  assert.deepEqual(resizeGridRect(initial, "w", 20, 0), {
    x: 3,
    y: 2,
    width: 3,
    height: 3,
  });
  assert.deepEqual(resizeGridRect(initial, "n", 0, 20), {
    x: 2,
    y: 3,
    width: 4,
    height: 2,
  });
});

test("pointer/grid conversion is clamped and scale independent", () => {
  const canvas = { left: 100, top: 50, width: 1200, height: 800 };
  assert.deepEqual(pointToGridCell(100, 50, canvas), { x: 0, y: 0 });
  assert.deepEqual(pointToGridCell(1299, 849, canvas), {
    x: GRID_COLUMNS - 1,
    y: GRID_ROWS - 1,
  });
  assert.deepEqual(pointToGridCell(-1000, -1000, canvas), { x: 0, y: 0 });
  assert.deepEqual(pointerDeltaToGrid(199, 149, 1200, 800), { x: 2, y: 1 });
});

test("persisted undersized logical geometry remains logical and can expand when space exists", () => {
  const persisted = legacyPixelsToGrid({ x: 8, y: 5, width: 2, height: 1 });
  assert.deepEqual(persisted, { x: 8, y: 5, width: 2, height: 1 });
  assert.deepEqual(findNearestFreeRect(persisted, []), {
    x: 8,
    y: 5,
    width: 3,
    height: 2,
  });
});

test("over-capacity legacy layouts can preserve an undersized non-overlapping fallback", () => {
  const persisted = legacyPixelsToGrid({ x: 9, y: 6, width: 2, height: 1 });
  const occupied = [{ x: 0, y: 0, width: GRID_COLUMNS, height: 6 }];
  assert.equal(findNearestFreeRect(persisted, occupied), null);
  assert.equal(collides(persisted, occupied), false);
});

test("legacy pixel geometry converts to the current logical grid", () => {
  assert.deepEqual(
    legacyPixelsToGrid({ x: 75, y: 76.75, width: 300, height: 230.25 }),
    { x: 1, y: 1, width: 4, height: 3 },
  );
});
