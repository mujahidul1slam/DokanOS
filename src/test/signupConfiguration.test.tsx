import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, functions: { invoke: vi.fn() }, auth: { signUp: vi.fn() } },
}));
vi.mock("@/components/TurnstileWidget", () => ({
  TurnstileWidget: () => null,
}));

import Signup from "@/pages/Signup";

function renderSignup() {
  return render(<MemoryRouter><Signup /></MemoryRouter>);
}

describe("signup configuration state", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("waits for configuration before exposing the signup form", async () => {
    let resolveConfig!: (value: { data: boolean; error: null }) => void;
    rpc.mockReturnValue(new Promise((resolve) => { resolveConfig = resolve; }));
    renderSignup();

    expect(screen.queryByLabelText("Your Name")).not.toBeInTheDocument();
    resolveConfig({ data: true, error: null });
    expect(await screen.findByLabelText("Your Name")).toBeInTheDocument();
  });

  it("keeps the form hidden when signup is explicitly closed", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    renderSignup();

    expect(await screen.findByText("Sign Up Currently Closed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your Name")).not.toBeInTheDocument();
  });

  it("shows a configuration error instead of a signup form when lookup fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "lookup denied" } });
    renderSignup();

    expect(await screen.findByText("Unable to check sign-up availability")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your Name")).not.toBeInTheDocument();
  });
});
