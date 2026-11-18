/** The supplied URL is the API root, including any version or proxy path. */
export function customProviderBaseURL(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 500 || /[?#]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const base = url.href.replace(/\/+$/, "");
    return base.length <= 500 ? base : null;
  } catch {
    return null;
  }
}
