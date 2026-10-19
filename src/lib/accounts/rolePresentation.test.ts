import { describe, expect, it } from "vitest";
import {
  accountRoleClass,
  canCreateBusinessResources,
  navigationRoleForBusinessRole,
} from "./rolePresentation";

describe("business role presentation and UI capabilities", () => {
  it("maps business roles consistently without making them server authority", () => {
    expect(accountRoleClass("owner")).toBe("owner");
    expect(accountRoleClass("admin")).toBe("owner");
    expect(accountRoleClass("member")).toBe("operator");
    expect(accountRoleClass("viewer")).toBe("viewer");
    expect(accountRoleClass("unknown")).toBeNull();
  });

  it("shows operator navigation and resource creation only for account operators", () => {
    expect(navigationRoleForBusinessRole("member")).toBe("staff");
    expect(navigationRoleForBusinessRole("owner")).toBe("admin");
    expect(canCreateBusinessResources("member")).toBe(true);
    expect(canCreateBusinessResources("viewer")).toBe(false);
    expect(canCreateBusinessResources("unknown")).toBe(false);
  });
});
