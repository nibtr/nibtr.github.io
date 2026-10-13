// Fixed timezone so dates render the same on any machine (dev vs CI).
const TIME_ZONE = "Asia/Ho_Chi_Minh";

// "en-CA" formats as YYYY-MM-DD.
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}
