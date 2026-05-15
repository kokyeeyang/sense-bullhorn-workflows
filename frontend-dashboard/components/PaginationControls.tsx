export const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    page: safePage,
    totalPages,
    items: items.slice(start, start + pageSize),
  };
}

export function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems === 0 ? 0 : (Math.min(page, totalPages) - 1) * pageSize + 1;
  const end = Math.min(totalItems, Math.min(page, totalPages) * pageSize);

  return (
    <div className="paginationControls">
      <span>
        {start}-{end} of {totalItems}
      </span>
      <label>
        Rows
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
