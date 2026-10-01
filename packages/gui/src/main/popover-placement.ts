export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface DisplayInfo {
  bounds: Rect;
  workArea: Rect;
}

export type TaskbarEdge = 'top' | 'bottom' | 'left' | 'right';

const GAP = 4;
const BLUR_TOGGLE_GUARD_MS = 200;

/** The taskbar edge is where the work area is inset from the display bounds. */
export function inferTaskbarEdge(display: DisplayInfo): TaskbarEdge | null {
  const { bounds: b, workArea: w } = display;
  const insets: Record<TaskbarEdge, number> = {
    top: w.y - b.y,
    left: w.x - b.x,
    bottom: b.y + b.height - (w.y + w.height),
    right: b.x + b.width - (w.x + w.width),
  };
  let best: TaskbarEdge | null = null;
  let max = 0;
  for (const edge of ['bottom', 'top', 'left', 'right'] as const) {
    if (insets[edge] > max) {
      max = insets[edge];
      best = edge;
    }
  }
  return best;
}

function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function anchorTo(anchor: Rect, display: DisplayInfo, size: Size): Point {
  const edge = inferTaskbarEdge(display) ?? 'bottom';
  const cx = anchor.x + anchor.width / 2;
  const cy = anchor.y + anchor.height / 2;
  let x: number;
  let y: number;
  switch (edge) {
    case 'top':
      x = cx - size.width / 2;
      y = anchor.y + anchor.height + GAP;
      break;
    case 'left':
      x = anchor.x + anchor.width + GAP;
      y = cy - size.height / 2;
      break;
    case 'right':
      x = anchor.x - size.width - GAP;
      y = cy - size.height / 2;
      break;
    default:
      x = cx - size.width / 2;
      y = anchor.y - size.height - GAP;
  }
  const w = display.workArea;
  return {
    x: Math.round(clamp(x, w.x, w.x + w.width - size.width)),
    y: Math.round(clamp(y, w.y, w.y + w.height - size.height)),
  };
}

/** Work-area corner nearest the taskbar (bottom-right when there is no inset). */
function cornerPosition(display: DisplayInfo, size: Size): Point {
  const edge = inferTaskbarEdge(display);
  const w = display.workArea;
  const right = w.x + w.width - size.width;
  const bottomY = w.y + w.height - size.height;
  if (edge === 'top') return { x: right, y: w.y };
  if (edge === 'left') return { x: w.x, y: bottomY };
  return { x: right, y: bottomY };
}

/**
 * Where to put the popover: anchored to the tray icon, else the cursor, else
 * the work-area corner nearest the taskbar. `displays[0]` must be the primary.
 */
export function placePopover(args: {
  trayBounds: Rect;
  cursor: Point;
  size: Size;
  displays: DisplayInfo[];
}): Point {
  const { trayBounds, cursor, size, displays } = args;

  if (trayBounds.width > 0 && trayBounds.height > 0) {
    const center = {
      x: trayBounds.x + trayBounds.width / 2,
      y: trayBounds.y + trayBounds.height / 2,
    };
    const display = displays.find((d) => contains(d.bounds, center));
    if (display) return anchorTo(trayBounds, display, size);
  }

  const cursorDisplay = displays.find((d) => contains(d.bounds, cursor));
  if (cursorDisplay) {
    return anchorTo({ x: cursor.x, y: cursor.y, width: 0, height: 0 }, cursorDisplay, size);
  }

  return cornerPosition(displays[0], size);
}

/** A tray click right after a blur-hide is the click that caused the blur. */
export function shouldIgnoreToggle(lastBlurHideAt: number | null, now: number): boolean {
  return lastBlurHideAt !== null && now - lastBlurHideAt < BLUR_TOGGLE_GUARD_MS;
}
