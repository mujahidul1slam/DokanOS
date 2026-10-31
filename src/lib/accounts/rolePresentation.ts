/** Presentation-only mapping for legacy UI navigation; never server authority. */
export type NavigationRole = "admin" | "staff" | "viewer";
export type AccountRoleClass = "owner" | "operator" | "viewer" | null;

/**
 * The business-wide role ladder (spec §5): Owner → Admin → Manager → Staff.
 * Stored values are lowercase owner/admin/manager/staff (Task 12 renamed the
 * member/viewer values); these are the display labels shown in the members
 * page and the invite picker.
 */
export const ROLE_LADDER: ReadonlyArray<{ value: string; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "staff", label: "Staff" },
];

/** Display label for a stored role value. */
export function roleLabel(role: string | null | undefined): string {
  return ROLE_LADDER.find((r) => r.value === role)?.label ?? role ?? "";
}

/** UI capability classification only; database/RPC checks remain authoritative. */
export function accountRoleClass(role: string | null | undefined): AccountRoleClass {
  if (role === "owner") return "owner";
  if (role === "admin") return "operator";
  if (role === "manager") return "operator";
  if (role === "staff") return "viewer";
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
