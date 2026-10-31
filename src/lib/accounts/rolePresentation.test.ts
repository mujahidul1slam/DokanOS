import { describe, expect, it } from "vitest";
import {
  accountRoleClass,
  canCreateBusinessResources,
  navigationRoleForBusinessRole,
} from "./rolePresentation";

describe("business role presentation and UI capabilities", () => {
  it("maps business roles consistently without making them server authority", () => {
    expect(accountRoleClass("owner")).toBe("owner");
    expect(accountRoleClass("admin")).toBe("operator");
    expect(accountRoleClass("manager")).toBe("operator");
    // "staff" maps to the internal viewer-class capability tier.
    expect(accountRoleClass("staff")).toBe("viewer");
    expect(accountRoleClass("unknown")).toBeNull();
  });

  it("shows operator navigation and resource creation only for account operators", () => {
    expect(navigationRoleForBusinessRole("manager")).toBe("staff");
    expect(navigationRoleForBusinessRole("owner")).toBe("admin");
    expect(navigationRoleForBusinessRole("admin")).toBe("staff");
    expect(canCreateBusinessResources("manager")).toBe(true);
    expect(canCreateBusinessResources("staff")).toBe(false);
    expect(canCreateBusinessResources("unknown")).toBe(false);
  });
});
