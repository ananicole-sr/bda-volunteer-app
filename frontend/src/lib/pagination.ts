import type { Page, PageOptions } from '@/types/volunteer';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** page >= 1 y pageSize en [1, 50]; devuelve el rango para .range(from, to). */
export function pageRange({ page = 1, pageSize = DEFAULT_PAGE_SIZE }: PageOptions = {}) {
  const p = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1));
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number.isFinite(pageSize) ? pageSize : DEFAULT_PAGE_SIZE)));
  const from = (p - 1) * size;
  return { page: p, pageSize: size, from, to: from + size - 1 };
}

export function toPage<T>(
  items: T[],
  total: number | null,
  r: { page: number; pageSize: number; from: number }
): Page<T> {
  const t = total ?? items.length;
  return { items, page: r.page, pageSize: r.pageSize, total: t, hasMore: r.from + items.length < t };
}
