// Evaluated before the Supabase client is imported by useAuth. The SDK removes
// the callback hash while initializing, before lazy callback pages can mount.
// Keep only the intent, never credentials or the raw hash.
export const initialAuthCallbackType = typeof window === "undefined"
  ? null
  : new URLSearchParams(window.location.hash.slice(1)).get("type");
