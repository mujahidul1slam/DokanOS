import { beforeEach, describe, expect, it, vi } from "vitest";

// Task 14 gap fix (2026-11-01): scaffoldStorefront must SURFACE page/section
// insert failures (throw) instead of swallowing them — the create pipeline
// catches the throw and reports honestly. When the pages RLS rejected writes
// (the pre-fix world for real accounts), the old silent swallow made the
// pipeline claim "starter pages were published" over an empty scaffold.

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { scaffoldStorefront } from "@/storefront/lib/pages";

type Result = { data?: unknown; error?: unknown };

const queues: Record<string, Result[]> = {};
const insertPayloads: Record<string, unknown[]> = {};

function push(table: string, ...results: Result[]) {
  (queues[table] ??= []).push(...results);
}

beforeEach(() => {
  for (const key of Object.keys(queues)) delete queues[key];
  for (const key of Object.keys(insertPayloads)) delete insertPayloads[key];
  vi.clearAllMocks();
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const queue = queues[table] ?? [];
    const builder: {
      select: () => unknown;
      insert: (payload: unknown) => unknown;
      update: () => unknown;
      eq: () => unknown;
      order: () => unknown;
      single: () => unknown;
      maybeSingle: () => unknown;
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      select: () => builder,
      insert: (payload: unknown) => {
        (insertPayloads[table] ??= []).push(payload);
        return builder;
      },
      update: () => builder,
      eq: () => builder,
      order: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      then: (resolve, reject) =>
        Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject),
    };
    return builder;
  });
});

describe("scaffoldStorefront — error surfacing", () => {
  it("creates Home + sections + Contact on the happy path", async () => {
    push("storefront_pages", { data: [] }, { data: { id: "p1" }, error: null }, { error: null });
    push("storefront_page_sections", { error: null });

    await expect(scaffoldStorefront("sf-1", "My Brand", "editorial")).resolves.toBeUndefined();

    expect(insertPayloads.storefront_pages).toHaveLength(2);
    expect(insertPayloads.storefront_page_sections).toHaveLength(1);
  });

  it("is idempotent — existing pages are skipped, nothing inserted", async () => {
    push("storefront_pages", { data: [{ slug: "home" }, { slug: "contact" }] });

    await expect(scaffoldStorefront("sf-1", "My Brand", "editorial")).resolves.toBeUndefined();

    expect(insertPayloads.storefront_pages ?? []).toHaveLength(0);
    expect(insertPayloads.storefront_page_sections ?? []).toHaveLength(0);
  });

  it("throws when the Home page insert is rejected", async () => {
    push("storefront_pages", { data: [] }, { data: null, error: { message: "rls home" } });

    await expect(scaffoldStorefront("sf-1", "My Brand", "editorial")).rejects.toMatchObject({
      message: "rls home",
    });
  });

  it("throws when the Home sections insert is rejected", async () => {
    push("storefront_pages", { data: [] }, { data: { id: "p1" }, error: null });
    push("storefront_page_sections", { error: { message: "rls sections" } });

    await expect(scaffoldStorefront("sf-1", "My Brand", "editorial")).rejects.toMatchObject({
      message: "rls sections",
    });
  });

  it("throws when the Contact page insert is rejected", async () => {
    push("storefront_pages", { data: [] }, { data: { id: "p1" }, error: null }, { error: { message: "rls contact" } });
    push("storefront_page_sections", { error: null });

    await expect(scaffoldStorefront("sf-1", "My Brand", "editorial")).rejects.toMatchObject({
      message: "rls contact",
    });
  });
});
