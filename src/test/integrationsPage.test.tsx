import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }> };

let queries: Query[] = [];
let rows: Record<string, unknown[]> = {};
let failTable: string | null = null;

const makeBuilder = (query: Query) => {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "maybeSingle", "limit", "update"]) {
    b[method] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      return b;
    });
  }
  b.then = (onFulfilled: (value: unknown) => unknown) => {
    const result =
      failTable === query.table
        ? { data: null, error: { message: "boom" } }
        : { data: rows[query.table] ?? [], error: null, count: null };
    return Promise.resolve(result).then(onFulfilled);
  };
  return b;
};

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

const ctxMock = vi.fn();
vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: () => ctxMock() }));

import { supabase } from "@/integrations/supabase/client";
import Integrations from "@/pages/Integrations";

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

const renderPage = (): ReturnType<typeof render> =>
  render(
    (
      <MemoryRouter>
        <Integrations />
      </MemoryRouter>
    ) as unknown as ReactNode,
  );

const queriesFor = (table: string) => queries.filter((q) => q.table === table);
const updateCallsFor = (table: string) =>
  queriesFor(table).flatMap((q) => q.calls.filter((c) => c.method === "update").map((c) => c.args[0]));

beforeEach(() => {
  queries = [];
  rows = {};
  failTable = null;
  ctxMock.mockReturnValue({
    active: { id: "biz-1" },
    brands: [{ id: "brand-1", name: "Nuvia", woo_store_id: null }],
    myRole: "owner",
    loading: false,
    contextReady: true,
  });
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    return makeBuilder(query);
  });
});

afterEach(() => {
  cleanup();
});

const sourceRow = (over: Record<string, unknown> = {}) => ({
  id: "os-1",
  brand_id: "brand-1",
  name: "Nuvia Storefront",
  type: "storefront",
  config: { slug: "nuvia" },
  sync_direction: null,
  last_sync_at: null,
  last_sync_error: null,
  is_stock_holding: false,
  is_default: false,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("Integrations page — management surface", () => {
  it("manages order sources and couriers in their own sections", async () => {
    rows = {
      order_sources: [sourceRow()],
      courier_services: [
        {
          id: "cs-1",
          business_id: "biz-1",
          provider: "pathao",
          name: "Nuvia Courier",
          credentials: { client_id: "x", client_secret: "y", username: "u", password: "p" },
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      pathao_integrations: [],
    };

    renderPage();

    expect(await screen.findByText("Nuvia Storefront")).toBeInTheDocument();
    expect(screen.getByText("Nuvia Courier")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /order sources/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /couriers/i })).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    // Management affordances live here now — no hand-off links.
    expect(screen.getByRole("button", { name: /new source/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new service/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /configure/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /manage/i })).toBeNull();
  });

  it("shows the default source and lets the operator move it", async () => {
    rows = {
      order_sources: [
        sourceRow({ id: "os-1", name: "Facebook", type: "facebook", is_default: true }),
        sourceRow({ id: "os-2", name: "Phone Orders", type: "manual" }),
      ],
      courier_services: [],
      pathao_integrations: [],
    };

    renderPage();

    // "Default" appears in the column header and on the starred source.
    expect((await screen.findAllByText("Default")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Set Phone Orders as the default source for new orders" }));

    await waitFor(() => expect(updateCallsFor("order_sources")).toHaveLength(2));
    // Clear the brand's previous default first — the partial unique index
    // (one default per brand) rejects a second default while one exists.
    expect(updateCallsFor("order_sources")[0]).toEqual({ is_default: false });
    expect(updateCallsFor("order_sources")[1]).toEqual({ is_default: true });
  });

  it("shows inline empty states instead of hand-off links", async () => {
    renderPage();

    expect(await screen.findByText(/No order sources yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add source/i })).toBeInTheDocument();
    expect(screen.getByText(/No courier services yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new service/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create order source/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /add a courier service/i })).toBeNull();
  });

  it("fails closed: an active business with no brands issues no order-source read", async () => {
    ctxMock.mockReturnValue({
      active: { id: "biz-1" },
      brands: [],
      myRole: "owner",
      loading: false,
      contextReady: true,
    });

    renderPage();

    expect(await screen.findByText(/Order sources belong to a brand/)).toBeInTheDocument();
    expect(queriesFor("order_sources")).toHaveLength(0);
    expect(queriesFor("courier_services")).toHaveLength(1);
  });

  it("surfaces a load error with a retry", async () => {
    failTable = "courier_services";

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to load courier services/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("asks for a business instead of reading anything when none is active", async () => {
    ctxMock.mockReturnValue({
      active: null,
      brands: [],
      myRole: "owner",
      loading: false,
      contextReady: true,
    });

    renderPage();

    expect(await screen.findByText(/Select a business to see its integrations/)).toBeInTheDocument();
    await waitFor(() => expect(queries).toHaveLength(0));
  });
});
