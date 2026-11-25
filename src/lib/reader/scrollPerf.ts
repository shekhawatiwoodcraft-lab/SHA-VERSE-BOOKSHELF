export interface BlockBounds {
  top: number;
  bottom: number;
}

/**
 * Finds the first block whose bottom edge is at or below `viewportTop`
 * using O(log N) binary search over monotonic vertical document order.
 */
export function findFirstVisibleBlockIndex(
  count: number,
  getBounds: (index: number) => BlockBounds,
  viewportTop: number,
): number {
  if (count <= 0) return -1;

  let lo = 0;
  let hi = count - 1;
  let answer = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const { bottom } = getBounds(mid);
    if (bottom >= viewportTop) {
      answer = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return answer;
}

export interface PaginationSnapshot {
  page: number;
  totalPages: number;
  percent: number;
  chapterTitle: string;
}

export function hasPaginationChanged(
  prev: PaginationSnapshot | null | undefined,
  next: PaginationSnapshot,
): boolean {
  if (!prev) return true;
  return (
    prev.page !== next.page ||
    prev.totalPages !== next.totalPages ||
    prev.percent !== next.percent ||
    prev.chapterTitle !== next.chapterTitle
  );
}
