import type { Clip, Track } from '../types/daw';

export const TAKE_LANE_HEIGHT = 26;

export function groupTakes(clips: Clip[]): Map<string, Clip[]> {
  const groups = new Map<string, Clip[]>();
  for (const clip of clips) {
    if (!clip.takeGroupId || clip.takeNumber === undefined) continue;
    const group = groups.get(clip.takeGroupId) ?? [];
    group.push(clip);
    groups.set(clip.takeGroupId, group);
  }
  return groups;
}

export function getTrackTakeCount(track: Track): number {
  let count = 0;
  for (const takes of groupTakes(track.clips).values()) {
    count = Math.max(count, ...takes.map((clip) => clip.takeNumber ?? 0));
  }
  return count;
}

export function getActiveTakeNumber(takes: Clip[]): number {
  return takes.reduce(
    (active, clip) => clip.activeTake ? Math.max(active, clip.takeNumber ?? 0) : active,
    0,
  ) || Math.max(0, ...takes.map((clip) => clip.takeNumber ?? 0));
}

export function getTrackDisplayHeight(track: Track): number {
  if (!track.showAllTakes) return 72;
  return Math.max(72, getTrackTakeCount(track) * TAKE_LANE_HEIGHT + 12);
}

export function getAudibleClips(clips: Clip[]): Clip[] {
  const regularClips = clips.filter((clip) => !clip.takeGroupId || clip.takeNumber === undefined);
  const audibleClips = [...regularClips];

  for (const takes of groupTakes(clips).values()) {
    const hasExplicitActiveTake = takes.some((clip) => clip.activeTake);
    const activeTakeNumber = getActiveTakeNumber(takes);
    const priorityGroups: Clip[][] = [];
    const assigned = new Set<Clip>();
    if (hasExplicitActiveTake) {
      const activeTakes = takes.filter((clip) => clip.takeNumber === activeTakeNumber);
      priorityGroups.push(activeTakes);
      activeTakes.forEach((clip) => assigned.add(clip));
    } else {
      const compedTakes = takes.filter((clip) => clip.comped);
      if (compedTakes.length > 0) {
        priorityGroups.push(compedTakes);
        compedTakes.forEach((clip) => assigned.add(clip));
      }
    }
    const takeNumbers = [...new Set(takes.map((clip) => clip.takeNumber ?? 0))].sort((a, b) => b - a);
    for (const takeNumber of takeNumbers) {
      const takeClips = takes.filter((clip) => clip.takeNumber === takeNumber && !assigned.has(clip));
      if (takeClips.length === 0) continue;
      priorityGroups.push(takeClips);
      takeClips.forEach((clip) => assigned.add(clip));
    }
    const covered: Array<[number, number]> = [];

    for (const priorityGroup of priorityGroups) {
      const groupRanges: Array<[number, number]> = [];
      for (const clip of priorityGroup) {
        const clipEnd = clip.startBeat + clip.durationBeats;
        let visibleRanges: Array<[number, number]> = [[clip.startBeat, clipEnd]];

        for (const [coveredStart, coveredEnd] of covered) {
          visibleRanges = visibleRanges.flatMap(([start, end]) => {
            if (coveredEnd <= start || coveredStart >= end) return [[start, end]];
            const ranges: Array<[number, number]> = [];
            if (coveredStart > start) ranges.push([start, coveredStart]);
            if (coveredEnd < end) ranges.push([coveredEnd, end]);
            return ranges;
          });
        }

        for (const [startBeat, endBeat] of visibleRanges) {
          if (endBeat <= startBeat) continue;
          const startsAtClipEdge = startBeat === clip.startBeat;
          const endsAtClipEdge = endBeat === clipEnd;
          audibleClips.push({
            ...clip,
            startBeat,
            durationBeats: endBeat - startBeat,
            bufferOffsetBeats: (clip.bufferOffsetBeats ?? 0) + startBeat - clip.startBeat,
            fadeInDuration: startsAtClipEdge ? clip.fadeInDuration : 0,
            fadeOutDuration: endsAtClipEdge ? clip.fadeOutDuration : 0,
          });
        }

        groupRanges.push([clip.startBeat, clipEnd]);
      }
      covered.push(...groupRanges);
    }
  }

  return audibleClips;
}