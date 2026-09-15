import test from "node:test";
import assert from "node:assert/strict";

import {
  GRID_COLUMNS,
  GRID_ROWS,
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
    { x: 0, y: 7, width: GRID_COLUMNS, height: 1 },
  );
});

test("isValidGridRect rejects fractional and out-of-bounds geometry", () => {
  assert.equal(isValidGridRect({ x: 0, y: 0, width: 4, height: 3 }), true);
  assert.equal(isValidGridRect({ x: 0.5, y: 0, width: 4, height: 3 }), false);
  assert.equal(isValidGridRect({ x: 10, y: 0, width: 3, height: 3 }), false);
  assert.equal(isValidGridRect({ x: 0, y: 7, width: 1, height: 2 }), false);
});

test("overlap and collision treat touching edges as non-overlapping", () => {
  const first = { x: 0, y: 0, width: 2, height: 2 };
  const touching = { x: 2, y: 0, width: 2, height: 2 };
  const overlapping = { x: 1, y: 1, width: 2, height: 2 };

  assert.equal(overlaps(first, touching), false);
  assert.equal(overlaps(first, overlapping), true);
  assert.equal(collides(first, [touching]), false);
  assert.equal(collides(first, [touching, overlapping]), true);
});

test("findNearestFreeRect uses deterministic nearest placement and can shrink", () => {
  assert.deepEqual(
    findNearestFreeRect(
      { x: 0, y: 0, width: 2, height: 2 },
      [{ x: 0, y: 0, width: 2, height: 2 }],
    ),
    { x: 2, y: 0, width: 2, height: 2 },
  );

  const almostFullBoard = [
    { x: 0, y: 0, width: GRID_COLUMNS, height: GRID_ROWS - 1 },
    { x: 0, y: GRID_ROWS - 1, width: GRID_COLUMNS - 1, height: 1 },
  ];
  assert.deepEqual(
    findNearestFreeRect({ x: 0, y: 0, width: 4, height: 3 }, almostFullBoard),
    { x: GRID_COLUMNS - 1, y: GRID_ROWS - 1, width: 1, height: 1 },
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
    x: 5,
    y: 2,
    width: 1,
    height: 3,
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

test("legacy pixel geometry converts to the current logical grid", () => {
  assert.deepEqual(
    legacyPixelsToGrid({ x: 75, y: 76.75, width: 300, height: 230.25 }),
    { x: 1, y: 1, width: 4, height: 3 },
  );
});
