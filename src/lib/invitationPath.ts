/** Carry an opaque invitation reference, never an account ID, role, or grant. */
export function invitationPath(path: string, params = new URLSearchParams(window.location.search)): string {
  const invitation = params.get("invite");
  if (!invitation || invitation.length > 512) return path;
  const [pathname, query = ""] = path.split("?");
  const next = new URLSearchParams(query);
  next.set("invite", invitation);
  return `${pathname}?${next}`;
}
