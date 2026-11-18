/**
 * Reads every row of a bounded query past the Supabase API's 1,000-row cap,
 * one page at a time. The query must have a stable order (end it with a
 * unique column) so pages neither skip nor repeat rows.
 */
export async function readAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, maxRows = 20_000 } = {},
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
  // shortcut: callers bound their ranges (e.g. 6 months), so 20,000 rows is
  // a safety stop, not a limit users meet; raise it if a range ever needs more.
  return {
    data: rows,
    error: { message: `More than ${maxRows} rows; narrow the filter.` },
  };
}
