export interface StatusRingSegment {
  id: string;
  index: number;
  viewed: boolean;
  d: string;
  startAngle: number;
  endAngle: number;
}

export interface StatusRingModel {
  count: number;
  hasActive: boolean;
  hasUnviewed: boolean;
  viewedCount: number;
  unviewedCount: number;
  segments: StatusRingSegment[];
}

export function buildStatusRingSegments(
  promotions: ReadonlyArray<{ id: string }>,
  viewedIds: ReadonlySet<string>,
  radius = 18.2,
  center = 20,
): StatusRingModel {
  const count = promotions.length;
  if (count === 0) {
    return {
      count: 0,
      hasActive: false,
      hasUnviewed: false,
      viewedCount: 0,
      unviewedCount: 0,
      segments: [],
    };
  }

  let viewedCount = 0;
  let unviewedCount = 0;

  if (count === 1) {
    const viewed = viewedIds.has(promotions[0].id);
    if (viewed) viewedCount = 1;
    else unviewedCount = 1;

    return {
      count: 1,
      hasActive: true,
      hasUnviewed: unviewedCount > 0,
      viewedCount,
      unviewedCount,
      segments: [
        {
          id: promotions[0].id,
          index: 0,
          viewed,
          d: '',
          startAngle: -90,
          endAngle: 270,
        },
      ],
    };
  }

  const sliceDeg = 360 / count;
  const gapDeg = Math.min(16, Math.max(7, sliceDeg * 0.16));

  const segments: StatusRingSegment[] = promotions.map((item, index) => {
    const viewed = viewedIds.has(item.id);
    if (viewed) viewedCount += 1;
    else unviewedCount += 1;

    const startAngle = -90 + index * sliceDeg + gapDeg / 2;
    const endAngle = -90 + (index + 1) * sliceDeg - gapDeg / 2;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

    const d = `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;

    return {
      id: item.id,
      index,
      viewed,
      d,
      startAngle,
      endAngle,
    };
  });

  return {
    count,
    hasActive: true,
    hasUnviewed: unviewedCount > 0,
    viewedCount,
    unviewedCount,
    segments,
  };
}

export function findFirstUnviewedIndex(
  promotions: ReadonlyArray<{ id: string }>,
  viewedIds: ReadonlySet<string>,
): number {
  const idx = promotions.findIndex((item) => !viewedIds.has(item.id));
  return idx >= 0 ? idx : 0;
}
