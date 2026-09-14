export const GRID_COLUMNS = 12;
export const GRID_ROWS = 8;
export const DEFAULT_WIDGET_COLUMNS = 4;
export const DEFAULT_WIDGET_ROWS = 3;
export const MIN_WIDGET_COLUMNS = 1;
export const MIN_WIDGET_ROWS = 1;

export type GridRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export function clampGridRect(rect: GridRect): GridRect {
  const width = clamp(Math.round(rect.width), MIN_WIDGET_COLUMNS, GRID_COLUMNS);
  const height = clamp(Math.round(rect.height), MIN_WIDGET_ROWS, GRID_ROWS);
  const x = clamp(Math.round(rect.x), 0, GRID_COLUMNS - width);
  const y = clamp(Math.round(rect.y), 0, GRID_ROWS - height);
  return { x, y, width, height };
}

export function isValidGridRect(rect: GridRect): boolean {
  return (
    Object.values(rect).every(Number.isInteger) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width >= MIN_WIDGET_COLUMNS &&
    rect.height >= MIN_WIDGET_ROWS &&
    rect.x + rect.width <= GRID_COLUMNS &&
    rect.y + rect.height <= GRID_ROWS
  );
}

export function overlaps(first: GridRect, second: GridRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export function collides(rect: GridRect, others: GridRect[]): boolean {
  return others.some((other) => overlaps(rect, other));
}

export function findNearestFreeRect(desired: GridRect, others: GridRect[]): GridRect | null {
  const base = clampGridRect(desired);
  if (!collides(base, others)) {
    return base;
  }

  const candidates: GridRect[] = [];
  for (let y = 0; y <= GRID_ROWS - base.height; y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - base.width; x += 1) {
      const candidate = { x, y, width: base.width, height: base.height };
      if (!collides(candidate, others)) {
        candidates.push(candidate);
      }
    }
  }

  candidates.sort((left, right) => {
    const leftDistance = Math.abs(left.x - base.x) + Math.abs(left.y - base.y);
    const rightDistance = Math.abs(right.x - base.x) + Math.abs(right.y - base.y);
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  });
  if (candidates[0]) {
    return candidates[0];
  }

  for (let height = base.height; height >= MIN_WIDGET_ROWS; height -= 1) {
    for (let width = base.width; width >= MIN_WIDGET_COLUMNS; width -= 1) {
      if (width === base.width && height === base.height) {
        continue;
      }
      const smaller = findNearestFreeRect(
        { x: base.x, y: base.y, width, height },
        others,
      );
      if (smaller) {
        return smaller;
      }
    }
  }
  return null;
}

export function rectToStyle(rect: GridRect): string {
  const left = (rect.x / GRID_COLUMNS) * 100;
  const top = (rect.y / GRID_ROWS) * 100;
  const width = (rect.width / GRID_COLUMNS) * 100;
  const height = (rect.height / GRID_ROWS) * 100;
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
}

export function pointToGridCell(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
): { x: number; y: number } {
  const x = Math.floor(((clientX - canvasRect.left) / Math.max(1, canvasRect.width)) * GRID_COLUMNS);
  const y = Math.floor(((clientY - canvasRect.top) / Math.max(1, canvasRect.height)) * GRID_ROWS);
  return {
    x: clamp(x, 0, GRID_COLUMNS - 1),
    y: clamp(y, 0, GRID_ROWS - 1),
  };
}

export function pointerDeltaToGrid(
  deltaX: number,
  deltaY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: Math.round(deltaX / Math.max(1, canvasWidth / GRID_COLUMNS)),
    y: Math.round(deltaY / Math.max(1, canvasHeight / GRID_ROWS)),
  };
}

export function resizeGridRect(
  initial: GridRect,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
): GridRect {
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;

  if (direction.includes("w")) {
    left = clamp(initial.x + deltaX, 0, right - MIN_WIDGET_COLUMNS);
  }
  if (direction.includes("e")) {
    right = clamp(initial.x + initial.width + deltaX, left + MIN_WIDGET_COLUMNS, GRID_COLUMNS);
  }
  if (direction.includes("n")) {
    top = clamp(initial.y + deltaY, 0, bottom - MIN_WIDGET_ROWS);
  }
  if (direction.includes("s")) {
    bottom = clamp(initial.y + initial.height + deltaY, top + MIN_WIDGET_ROWS, GRID_ROWS);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function legacyPixelsToGrid(rect: GridRect): GridRect {
  // The pre-grid Board was nominally ~900×614 CSS px. Conversion is only
  // used when persisted values are clearly not already logical grid units.
  return clampGridRect({
    x: Math.round(rect.x / (900 / GRID_COLUMNS)),
    y: Math.round(rect.y / (614 / GRID_ROWS)),
    width: Math.round(rect.width / (900 / GRID_COLUMNS)),
    height: Math.round(rect.height / (614 / GRID_ROWS)),
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
