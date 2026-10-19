/** Presentation-only mapping for legacy UI navigation; never server authority. */
export type NavigationRole = "admin" | "staff" | "viewer";
export type AccountRoleClass = "owner" | "operator" | "viewer" | null;

/** UI capability classification only; database/RPC checks remain authoritative. */
export function accountRoleClass(role: string | null | undefined): AccountRoleClass {
  if (role === "owner" || role === "admin") return "owner";
  if (role === "member") return "operator";
  if (role === "viewer") return "viewer";
  return null;
}

export function navigationRoleForBusinessRole(role: string | null | undefined): NavigationRole | null {
  const roleClass = accountRoleClass(role);
  if (roleClass === "owner") return "admin";
  if (roleClass === "operator") return "staff";
  return roleClass;
}

export function canCreateBusinessResources(role: string | null | undefined): boolean {
  return accountRoleClass(role) === "owner" || accountRoleClass(role) === "operator";
}
