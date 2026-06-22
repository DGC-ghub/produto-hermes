/**
 * Formats a Date to an ISO 8601 date string (YYYY-MM-DD).
 */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
