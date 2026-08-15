export const BEATS_PER_BAR = 4;
// The timeline's length is dynamic (see ArrangeView's totalBars calculation)
// so it always fits the project's actual content instead of truncating at a
// fixed length. These just bound that calculation: a floor so short/empty
// projects still get a reasonable amount of visible timeline, and a margin
// of extra bars left past the furthest clip so there's room to extend it.
export const MIN_TOTAL_BARS = 64;
export const TIMELINE_MARGIN_BARS = 8;
// PIXELS_PER_BEAT is now dynamic based on zoom level, use usePixelsPerBeat() hook
// Base value is 40, but can be zoomed
export const BASE_PIXELS_PER_BEAT = 40;
