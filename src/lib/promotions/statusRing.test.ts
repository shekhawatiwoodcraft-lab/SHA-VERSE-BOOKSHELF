import { describe, it, expect } from 'vitest';
import { buildStatusRingSegments, findFirstUnviewedIndex } from './statusRing';

describe('statusRing helper', () => {
  it('returns inactive empty model when there are no stories', () => {
    const model = buildStatusRingSegments([], new Set());
    expect(model.hasActive).toBe(false);
    expect(model.hasUnviewed).toBe(false);
    expect(model.segments).toHaveLength(0);
  });

  it('handles a single unseen and seen story properly', () => {
    const stories = [{ id: 's1' }];
    const unseen = buildStatusRingSegments(stories, new Set());
    expect(unseen.hasActive).toBe(true);
    expect(unseen.hasUnviewed).toBe(true);
    expect(unseen.unviewedCount).toBe(1);
    expect(unseen.segments[0].viewed).toBe(false);

    const seen = buildStatusRingSegments(stories, new Set(['s1']));
    expect(seen.hasActive).toBe(true);
    expect(seen.hasUnviewed).toBe(false);
    expect(seen.viewedCount).toBe(1);
    expect(seen.segments[0].viewed).toBe(true);
  });

  it('marks only visited stories as viewed while keeping unseen stories colored', () => {
    const stories = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
    const model = buildStatusRingSegments(stories, new Set(['s1', 's3']));

    expect(model.count).toBe(3);
    expect(model.hasUnviewed).toBe(true);
    expect(model.viewedCount).toBe(2);
    expect(model.unviewedCount).toBe(1);
    expect(model.segments.map((s) => s.viewed)).toEqual([true, false, true]);
    expect(model.segments.every((s) => s.d.startsWith('M ') && s.d.includes(' A '))).toBe(true);
  });

  it('finds the first unviewed story index or defaults to 0 when all are seen', () => {
    const stories = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(findFirstUnviewedIndex(stories, new Set())).toBe(0);
    expect(findFirstUnviewedIndex(stories, new Set(['a']))).toBe(1);
    expect(findFirstUnviewedIndex(stories, new Set(['a', 'b']))).toBe(2);
    expect(findFirstUnviewedIndex(stories, new Set(['a', 'b', 'c']))).toBe(0);
  });
});
