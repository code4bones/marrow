import { useState } from 'react';

export const DEFAULT_PAGE_SIZE = 25;

export function usePage(defaultSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);

  const offset = (page - 1) * pageSize;

  const onChange = (p: number, ps: number) => {
    if (ps !== pageSize) { setPageSize(ps); setPage(1); }
    else setPage(p);
  };

  return { page, pageSize, offset, onChange };
}
