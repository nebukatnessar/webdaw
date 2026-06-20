export const BEATS_PER_BAR = 4;
export const TOTAL_BARS = 64;
// PIXELS_PER_BEAT is now dynamic based on zoom level, use usePixelsPerBeat() hook
// Base value is 40, but can be zoomed
export const BASE_PIXELS_PER_BEAT = 40;
export const TOTAL_WIDTH = TOTAL_BARS * BEATS_PER_BAR * BASE_PIXELS_PER_BEAT; // 10 240 px
