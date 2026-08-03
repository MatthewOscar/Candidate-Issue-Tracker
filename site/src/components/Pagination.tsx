export default function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pagination">
      <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span>
        Page {page} of {pageCount}
      </span>
      <button className="btn btn-small" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </nav>
  );
}
