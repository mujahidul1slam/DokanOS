import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Resolver seam test (issue #13 follow-up): the permissions resolver consults
// the active account membership as the first-release baseline, even when old
// permission rows would restrict it. Context and client are module-mocked; nothing is
// written, so these cases also prove no user_roles/user_permissions rows are
// created on the client path.

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

import { useAuth } from "@/hooks/useAuth";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import { PermissionsProvider, usePermissions, type AppPermission } from "@/hooks/usePermissions";

const authMock = useAuth as unknown as Mock;
const businessMock = useBusinessContext as unknown as Mock;
const rpcMock = supabase.rpc as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;

const Probe = ({ perm }: { perm: AppPermission }) => {
  const { can, loading } = usePermissions();
  return <span data-testid="probe">{loading ? "loading" : can(perm) ? "yes" : "no"}</span>;
};

const renderProbe = (perm: AppPermission) =>
  render(
    <PermissionsProvider>
      <Probe perm={perm} />
    </PermissionsProvider>,
  );

const setContext = (opts: { role: string | null; loading?: boolean; globalAdmin?: boolean }) => {
  authMock.mockReturnValue({ user: { id: "u1" }, isAdmin: opts.globalAdmin ?? false });
  businessMock.mockReturnValue({
    active: opts.role ? { id: "b1" } : null,
    myRole: opts.role,
    rolesByBusiness: opts.role ? { b1: opts.role } : {},
    loading: opts.loading ?? false,
  });
};

describe("account membership permission resolution (#13 operational access)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    fromMock.mockImplementation(() => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    }));
  });

  it("keeps loading while the active account membership is still resolving", () => {
    setContext({ role: "member", loading: true });
    renderProbe("dashboard.view");
    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
  });

  it("member (no legacy rows) reaches operational modules but no management authority", async () => {
    setContext({ role: "member" });
    renderProbe("dashboard.view");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("yes"));
  });

  it("member can view orders and use POS", async () => {
    setContext({ role: "member" });
    render(
      <PermissionsProvider>
        <Probe perm="orders.view" />
        <Probe perm="pos.use" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      for (const el of screen.getAllByTestId("probe")) expect(el).toHaveTextContent("yes");
    });
  });

  it("member has account-wide operations including analytics, deletes, refunds and operational management", async () => {
    setContext({ role: "member" });
    render(
      <PermissionsProvider>
        <Probe perm="analytics.view" />
        <Probe perm="orders.refund" />
        <Probe perm="orders.delete" />
        <Probe perm="products.delete" />
        <Probe perm="analytics.view_revenue" />
        <Probe perm="integrations.manage" />
        <Probe perm="stores.manage" />
        <Probe perm="storefronts.view" />
        <Probe perm="settings.manage" />
        <Probe perm="team.manage" />
        <Probe perm="audit.view" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      const probes = screen.getAllByTestId("probe");
      for (const el of probes.slice(0, 8)) expect(el).toHaveTextContent("yes");
      for (const el of probes.slice(8)) expect(el).toHaveTextContent("no");
    });
  });

  it("viewer stays read-only: view basics yes, POS/write/management no", async () => {
    setContext({ role: "viewer" });
    render(
      <PermissionsProvider>
        <Probe perm="dashboard.view" />
        <Probe perm="orders.view" />
        <Probe perm="customers.view" />
        <Probe perm="products.view" />
        <Probe perm="pos.use" />
        <Probe perm="customers.edit" />
        <Probe perm="orders.create" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      const [dashboard, orders, customers, products, pos, editCustomer, createOrder] =
        screen.getAllByTestId("probe");
      expect(dashboard).toHaveTextContent("yes");
      expect(orders).toHaveTextContent("yes");
      expect(customers).toHaveTextContent("yes");
      expect(products).toHaveTextContent("yes");
      expect(pos).toHaveTextContent("no");
      expect(editCustomer).toHaveTextContent("no");
      expect(createOrder).toHaveTextContent("no");
    });
  });

  it("owner retains full account authority", async () => {
    setContext({ role: "owner" });
    render(
      <PermissionsProvider>
        <Probe perm="dashboard.view" />
        <Probe perm="settings.manage" />
        <Probe perm="team.manage" />
        <Probe perm="analytics.view" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      for (const el of screen.getAllByTestId("probe")) expect(el).toHaveTextContent("yes");
    });
  });

  it("non-member of the active account is denied (no membership baseline)", async () => {
    setContext({ role: null });
    renderProbe("dashboard.view");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("no"));
  });

  it("global platform role without account membership cannot access account operations", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "get_user_permissions" ? ["dashboard.view", "team.manage"] : [], error: null }),
    );
    setContext({ role: null, globalAdmin: true });
    renderProbe("dashboard.view");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("no"));
  });

  it("an owner's legacy explicit rows cannot restrict account authority", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "get_user_permissions" ? ["orders.view"] : [], error: null }),
    );
    setContext({ role: "owner" });
    render(
      <PermissionsProvider>
        <Probe perm="dashboard.view" />
        <Probe perm="orders.view" />
        <Probe perm="pos.use" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      const [dashboard, orders, pos] = screen.getAllByTestId("probe");
      expect(dashboard).toHaveTextContent("yes");
      expect(orders).toHaveTextContent("yes");
      expect(pos).toHaveTextContent("yes");
    });
  });

  it("a member's restrictive legacy rows cannot remove first-release operations", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "get_user_permissions" ? ["orders.view"] : [], error: null }),
    );
    setContext({ role: "member" });
    render(
      <PermissionsProvider>
        <Probe perm="dashboard.view" />
        <Probe perm="orders.refund" />
        <Probe perm="orders.view" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      for (const probe of screen.getAllByTestId("probe")) expect(probe).toHaveTextContent("yes");
    });
  });

  it("preserves existing viewer permission rows for compatibility", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "get_user_permissions" ? ["orders.view"] : [], error: null }),
    );
    setContext({ role: "viewer" });
    render(
      <PermissionsProvider>
        <Probe perm="orders.view" />
        <Probe perm="dashboard.view" />
      </PermissionsProvider>,
    );
    await waitFor(() => {
      const [orders, dashboard] = screen.getAllByTestId("probe");
      expect(orders).toHaveTextContent("yes");
      expect(dashboard).toHaveTextContent("no");
    });
  });

  it("creates no user_roles/user_permissions rows and only reads through the resolver RPCs", async () => {
    setContext({ role: "member" });
    renderProbe("dashboard.view");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("yes"));
    expect(fromMock.mock.calls.map((c) => (c as unknown[])[0])).not.toContain("user_roles");
    expect(fromMock.mock.calls.map((c) => (c as unknown[])[0])).not.toContain("user_permissions");
    expect(rpcMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
      expect.arrayContaining(["get_user_permissions", "get_user_store_ids"]),
    );
  });
});
