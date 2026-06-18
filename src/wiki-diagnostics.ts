export const staleReviewAgeDays = 30;

function dateOnlyMillis(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(millis) ? null : millis;
}

export function staleReviewAge(updated: string, currentDate: string): number | null {
  const updatedMillis = dateOnlyMillis(updated);
  const currentMillis = dateOnlyMillis(currentDate);
  if (updatedMillis === null || currentMillis === null) return null;
  const ageDays = Math.floor((currentMillis - updatedMillis) / 86_400_000);
  return ageDays > staleReviewAgeDays ? ageDays : null;
}
