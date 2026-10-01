import { describe, expect, it } from 'vitest';
import {
  type DisplayInfo,
  inferTaskbarEdge,
  placePopover,
  shouldIgnoreToggle,
} from '../../src/main/popover-placement.js';

const SIZE = { width: 360, height: 480 };
const GAP = 4;
const ORIGIN = { x: 0, y: 0 };

const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
const withWorkArea = (workArea: DisplayInfo['workArea'], b = bounds): DisplayInfo => ({
  bounds: b,
  workArea,
});

const bottom = withWorkArea({ x: 0, y: 0, width: 1920, height: 1040 });
const top = withWorkArea({ x: 0, y: 40, width: 1920, height: 1040 });
const left = withWorkArea({ x: 60, y: 0, width: 1860, height: 1080 });
const right = withWorkArea({ x: 0, y: 0, width: 1860, height: 1080 });

describe('inferTaskbarEdge', () => {
  it('detects each edge', () => {
    expect(inferTaskbarEdge(bottom)).toBe('bottom');
    expect(inferTaskbarEdge(top)).toBe('top');
    expect(inferTaskbarEdge(left)).toBe('left');
    expect(inferTaskbarEdge(right)).toBe('right');
  });

  it('returns null when there is no taskbar on the display', () => {
    expect(inferTaskbarEdge(withWorkArea(bounds))).toBeNull();
  });
});

describe('placePopover with valid tray bounds', () => {
  const place = (trayBounds: DisplayInfo['bounds'], displays: DisplayInfo[]) =>
    placePopover({ trayBounds, cursor: ORIGIN, size: SIZE, displays });

  it('places above a bottom taskbar, centred on the icon', () => {
    expect(place({ x: 1000, y: 1040, width: 24, height: 40 }, [bottom])).toEqual({
      x: 1000 + 12 - 180,
      y: 1040 - 480 - GAP,
    });
  });

  it('places below a top taskbar', () => {
    expect(place({ x: 1000, y: 0, width: 24, height: 40 }, [top])).toEqual({
      x: 1000 + 12 - 180,
      y: 40 + GAP,
    });
  });

  it('places to the right of a left taskbar, centred vertically on the icon', () => {
    expect(place({ x: 0, y: 500, width: 60, height: 24 }, [left])).toEqual({
      x: 60 + GAP,
      y: 512 - 240,
    });
  });

  it('places to the left of a right taskbar', () => {
    expect(place({ x: 1860, y: 500, width: 60, height: 24 }, [right])).toEqual({
      x: 1860 - 360 - GAP,
      y: 512 - 240,
    });
  });

  it('clamps into the work area', () => {
    const p = place({ x: 1900, y: 1040, width: 20, height: 40 }, [bottom]);
    expect(p.x).toBe(1920 - 360);
  });

  it('uses the secondary display containing the tray icon', () => {
    const secondary = withWorkArea(
      { x: 1920, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 1920, height: 1080 },
    );
    expect(place({ x: 3000, y: 1040, width: 24, height: 40 }, [bottom, secondary])).toEqual({
      x: 3012 - 180,
      y: 1040 - 480 - GAP,
    });
  });
});

describe('placePopover fallbacks', () => {
  const zero = { x: 0, y: 0, width: 0, height: 0 };

  it('falls back to the cursor when bounds are empty', () => {
    const p = placePopover({
      trayBounds: zero,
      cursor: { x: 1500, y: 1060 },
      size: SIZE,
      displays: [bottom],
    });
    expect(p).toEqual({ x: 1500 - 180, y: 1040 - 480 });
  });

  it('falls back to the cursor when bounds are off every display', () => {
    const p = placePopover({
      trayBounds: { x: -32000, y: -32000, width: 24, height: 24 },
      cursor: { x: 1500, y: 1060 },
      size: SIZE,
      displays: [bottom],
    });
    expect(p).toEqual({ x: 1320, y: 1040 - 480 });
  });

  it('falls back to the corner nearest the taskbar when the cursor is unusable', () => {
    const pos = (d: DisplayInfo) =>
      placePopover({ trayBounds: zero, cursor: { x: -5000, y: -5000 }, size: SIZE, displays: [d] });
    expect(pos(bottom)).toEqual({ x: 1920 - 360, y: 1040 - 480 });
    expect(pos(top)).toEqual({ x: 1920 - 360, y: 40 });
    expect(pos(left)).toEqual({ x: 60, y: 1080 - 480 });
    expect(pos(right)).toEqual({ x: 1860 - 360, y: 1080 - 480 });
  });

  it('defaults to the bottom-right corner when there is no taskbar edge', () => {
    const p = placePopover({
      trayBounds: zero,
      cursor: { x: -1, y: -1 },
      size: SIZE,
      displays: [withWorkArea(bounds)],
    });
    expect(p).toEqual({ x: 1920 - 360, y: 1080 - 480 });
  });
});

describe('shouldIgnoreToggle', () => {
  it('ignores a toggle within 200ms of a blur-hide', () => {
    expect(shouldIgnoreToggle(1000, 1150)).toBe(true);
  });

  it('allows a toggle after the window', () => {
    expect(shouldIgnoreToggle(1000, 1250)).toBe(false);
  });

  it('allows a toggle when there was no blur-hide', () => {
    expect(shouldIgnoreToggle(null, 1000)).toBe(false);
  });
});
