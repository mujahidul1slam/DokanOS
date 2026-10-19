import { expect, test, type Page } from "@playwright/test";

/**
 * Issue #13: business-account members are invited by the owner, join with an
 * already-verified personal identity, and never gain a platform role or a
 * brand/store/module grant. These journeys use the real admin UI against a
 * mocked Data API: the SQL battery and the local PostgREST probes prove the
 * authorization rules, this spec proves the two human journeys.
 */

const business = {
  id: "11111111-0000-0000-0000-000000000001",
  name: "Biz A Fixture",
  slug: "biz-a-fixture",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  is_active: true,
};

const owner = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "owner-a@dokanos.test",
  email_confirmed_at: "2026-10-19T00:00:00Z",
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Owner A" },
};

const member = {
  ...owner,
  id: "00000000-0000-0000-0000-000000000004",
  email: "member-a@dokanos.test",
  user_metadata: { full_name: "Member A" },
};

const viewer = {
  ...owner,
  id: "00000000-0000-0000-0000-000000000005",
  email: "viewer-a@dokanos.test",
  user_metadata: { full_name: "Viewer A" },
};

const invitee = {
  ...owner,
  id: "00000000-0000-0000-0000-000000000021",
  email: "invitee@dokanos.test",
  user_metadata: { full_name: "Invitee" },
};

type MemberPayload = {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  joined_at: string;
};

type InvitationPayload = {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expires_at: string;
};

type HarnessOptions = {
  user: typeof owner;
  role: "owner" | "member" | "viewer";
  members: MemberPayload[];
  /** Whether the signed-in identity already operates this account. */
  initiallyMember?: boolean;
  invitations?: InvitationPayload[];
  describe?: unknown | (() => unknown);
  accept?: unknown;
  acceptGrantsMembership?: boolean;
  /** Force a refused transfer so the surface must explain the refusal. */
  transferError?: { message: string; code?: string };
};

type LoggedRequest = {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
};

const ownerMember: MemberPayload = {
  user_id: owner.id,
  email: owner.email,
  full_name: "Owner A",
  role: "owner",
  joined_at: "2026-10-19T00:00:00Z",
};

const joinedMember: MemberPayload = {
  user_id: member.id,
  email: member.email,
  full_name: "Member A",
  role: "member",
  joined_at: "2026-10-19T01:00:00Z",
};

async function signedIn(page: Page, user: typeof owner) {
  await page.addInitScript(({ user, businessId }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "browser-test-token",
      refresh_token: "browser-test-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user,
    }));
    localStorage.setItem("dokanos-active-business-id", businessId);
  }, { user, businessId: business.id });
}

async function appHarness(page: Page, options: HarnessOptions) {
  const requests: LoggedRequest[] = [];
  const state = {
    members: options.members.map((row) => ({ ...row })),
    invitations: (options.invitations ?? []).map((row) => ({ ...row })),
    granted: options.initiallyMember ?? true,
    role: options.role as string,
  };

  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = (() => {
      try {
        return request.postDataJSON() as Record<string, unknown> | null;
      } catch {
        return null;
      }
    })();
    requests.push({ path: url.pathname, method, body });

    if (url.pathname.endsWith("/user_business_access")) {
      await route.fulfill({
        json: state.granted
          ? [{ role: state.role, business_id: business.id, businesses: business }]
          : [],
      });
      return;
    }
    if (url.pathname.endsWith("/rpc/list_business_members")) {
      await route.fulfill({ json: state.members });
      return;
    }
    if (url.pathname.endsWith("/rpc/list_business_invitations")) {
      await route.fulfill({ json: state.invitations });
      return;
    }
    if (url.pathname.endsWith("/rpc/invite_business_member")) {
      const email = String(body?.p_email ?? "").toLowerCase();
      const invitation: InvitationPayload = {
        id: `22222222-0000-0000-0000-${String(state.invitations.length + 1).padStart(12, "0")}`,
        email,
        role: "member",
        status: "pending",
        token: "invite-token-1",
        expires_at: "2026-11-02T00:00:00Z",
      };
      state.invitations.unshift(invitation);
      await route.fulfill({ json: { ...invitation, business_id: business.id, business_name: business.name } });
      return;
    }
    if (url.pathname.endsWith("/rpc/revoke_business_invitation")) {
      const invitation = state.invitations.find((row) => row.id === body?.p_invitation_id);
      if (invitation) invitation.status = "revoked";
      await route.fulfill({
        json: { revoked: true, invitation_id: body?.p_invitation_id, business_id: business.id, status: "revoked" },
      });
      return;
    }
    if (url.pathname.endsWith("/rpc/remove_business_member")) {
      state.members = state.members.filter((row) => row.user_id !== body?.p_user_id);
      await route.fulfill({ json: { removed: true, business_id: business.id, user_id: body?.p_user_id, role: "member" } });
      return;
    }
    if (url.pathname.endsWith("/rpc/transfer_business_ownership")) {
      if (options.transferError) {
        await route.fulfill({ status: 400, json: options.transferError });
        return;
      }
      const target = state.members.find((row) => row.user_id === body?.p_new_owner_id);
      const caller = state.members.find((row) => row.user_id === options.user.id);
      if (target) target.role = "owner";
      if (caller) caller.role = "member";
      state.role = "member";
      await route.fulfill({
        json: {
          transferred: true,
          business_id: business.id,
          business_name: business.name,
          previous_owner_id: options.user.id,
          previous_owner_role: "member",
          new_owner_id: body?.p_new_owner_id,
          new_owner_previous_role: "member",
          owner_count: 1,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/rpc/leave_business_account")) {
      const caller = state.members.find((row) => row.user_id === options.user.id);
      if (!caller) {
        await route.fulfill({ status: 400, json: { message: "MEMBER_NOT_FOUND: you are not a member of this account", code: "22023" } });
        return;
      }
      if (caller.role === "owner") {
        await route.fulfill({
          status: 400,
          json: { message: "OWNER_TRANSFER_REQUIRED: transfer ownership to another member before leaving", code: "23514" },
        });
        return;
      }
      state.members = state.members.filter((row) => row.user_id !== options.user.id);
      state.granted = false;
      await route.fulfill({
        json: { left: true, business_id: business.id, business_name: business.name, role: caller.role },
      });
      return;
    }
    if (url.pathname.endsWith("/rpc/describe_business_invitation")) {
      const described = typeof options.describe === "function" ? options.describe() : options.describe;
      await route.fulfill({ json: described ?? [] });
      return;
    }
    if (url.pathname.endsWith("/rpc/accept_business_invitation")) {
      if (options.acceptGrantsMembership) state.granted = true;
      await route.fulfill({
        json: options.accept ?? {
          outcome: "joined",
          business_id: business.id,
          business_name: business.name,
          role: "member",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/rpc/get_user_permissions") || url.pathname.endsWith("/rpc/get_user_store_ids")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/app_config")) {
      await route.fulfill({ json: { value: true } });
      return;
    }
    if (url.pathname.endsWith("/user")) {
      await route.fulfill({ json: options.user });
      return;
    }
    await route.fulfill({ json: [] });
  });

  return { requests, state };
}

test("the owner invites by email, sees the pending link, revokes it, and removes a member without creating a business", async ({ page }) => {
  const harness = await appHarness(page, {
    user: owner,
    role: "owner",
    members: [ownerMember, joinedMember],
  });
  await signedIn(page, owner);

  await page.goto("/members");
  await expect(page.getByRole("link", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByText(/2 members under Biz A Fixture/)).toBeVisible();
  await expect(page.getByRole("main").getByText(owner.email)).toBeVisible();
  await expect(page.getByRole("main").getByText(member.email)).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove ${owner.email}` })).toHaveCount(0);

  await page.getByLabel("Email address").fill("NewPerson@Example.com");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("newperson@example.com")).toBeVisible();

  const invite = harness.requests.find((request) =>
    request.method === "POST" && request.path.endsWith("/rpc/invite_business_member")
  );
  expect(invite?.body).toEqual({ p_business_id: business.id, p_email: "newperson@example.com" });
  await expect(page.getByText(/\/accounts\?invite=invite-token-1/)).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Revoke invitation for newperson@example.com" }).click();
  await expect.poll(() => harness.state.invitations[0]?.status).toBe("revoked");
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke invitation for newperson@example.com" })).toHaveCount(0);

  await page.getByRole("button", { name: `Remove ${member.email}` }).click();
  await expect.poll(() => harness.state.members.some((row) => row.user_id === member.id)).toBe(false);
  await expect(page.getByRole("main").getByText(member.email)).toHaveCount(0);
  await expect(page.getByRole("main").getByText(owner.email)).toBeVisible();
  await expect(page.getByText(/1 member under Biz A Fixture/)).toBeVisible();
  expect(harness.requests.some((request) =>
    request.method !== "GET" && /create-business|signup-provision|\/rest\/v1\/businesses$/.test(request.path)
  )).toBe(false);
});

test("an owner transfers ownership before leaving, and the former owner can then depart", async ({ page }) => {
  const harness = await appHarness(page, {
    user: owner,
    role: "owner",
    members: [ownerMember, joinedMember],
  });
  await signedIn(page, owner);

  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Ownership" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave account" })).toBeDisabled();
  await expect(page.getByText(/You cannot leave while you are an owner/)).toBeVisible();
  await expect(page.getByRole("button", { name: `Transfer ownership to ${owner.email}` })).toHaveCount(0);

  await page.getByRole("button", { name: `Transfer ownership to ${member.email}` }).click();
  await expect(page.getByRole("group", { name: "Confirm ownership transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm transfer" }).click();

  await expect.poll(() => harness.requests.some((request) =>
    request.method === "POST" && request.path.endsWith("/rpc/transfer_business_ownership")
  )).toBe(true);
  const transfer = harness.requests.find((request) =>
    request.method === "POST" && request.path.endsWith("/rpc/transfer_business_ownership")
  );
  expect(transfer?.body).toEqual({ p_business_id: business.id, p_new_owner_id: member.id });
  await expect(page.getByText(/Member A is now the owner of Biz A Fixture/).first()).toBeVisible();
  await expect.poll(() => harness.state.role).toBe("member");
  await expect.poll(() => harness.state.members.find((row) => row.user_id === member.id)?.role).toBe("owner");

  // The former owner is now an ordinary member: no transfer controls remain,
  // and departure is available without ever leaving the account ownerless.
  await expect(page.getByRole("button", { name: /^Transfer ownership to / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make owner" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave account" })).toBeEnabled();
  await page.getByRole("button", { name: "Leave account" }).click();
  await page.getByRole("button", { name: "Confirm leave" }).click();

  await expect(page).toHaveURL(/\/accounts/);
  const leave = harness.requests.find((request) =>
    request.method === "POST" && request.path.endsWith("/rpc/leave_business_account")
  );
  expect(leave?.body).toEqual({ p_business_id: business.id });
  await expect.poll(() => harness.state.members.some((row) => row.user_id === owner.id)).toBe(false);
  expect(harness.state.members.find((row) => row.user_id === member.id)?.role).toBe("owner");
});

test("a refused transfer keeps the owner in place and explains the refusal", async ({ page }) => {
  const harness = await appHarness(page, {
    user: owner,
    role: "owner",
    members: [ownerMember, joinedMember],
    transferError: { message: "TARGET_NOT_MEMBER: choose an existing member of this account", code: "22023" },
  });
  await signedIn(page, owner);

  await page.goto("/members");
  await page.getByRole("button", { name: `Transfer ownership to ${member.email}` }).click();
  await page.getByRole("button", { name: "Confirm transfer" }).click();

  await expect(page.getByRole("alert").filter({ hasText: /not an existing member of this account/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave account" })).toBeDisabled();
  expect(harness.state.role).toBe("owner");
  expect(harness.state.members.find((row) => row.user_id === owner.id)?.role).toBe("owner");
  expect(harness.state.members.find((row) => row.user_id === member.id)?.role).toBe("member");
});

test("an ordinary member leaves without any ownership control", async ({ page }) => {
  const harness = await appHarness(page, {
    user: member,
    role: "member",
    members: [ownerMember, joinedMember],
  });
  await signedIn(page, member);

  await page.goto("/members");
  await expect(page.getByRole("button", { name: /^Transfer ownership to / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make owner" })).toHaveCount(0);
  await page.getByRole("button", { name: "Leave account" }).click();
  await page.getByRole("button", { name: "Confirm leave" }).click();

  await expect(page).toHaveURL(/\/accounts/);
  const leave = harness.requests.find((request) =>
    request.method === "POST" && request.path.endsWith("/rpc/leave_business_account")
  );
  expect(leave?.body).toEqual({ p_business_id: business.id });
  expect(harness.state.members.find((row) => row.user_id === owner.id)?.role).toBe("owner");
});

test("a member can see who operates the account but gets no invitation or removal controls", async ({ page }) => {
  const harness = await appHarness(page, {
    user: member,
    role: "member",
    members: [ownerMember, joinedMember],
  });
  await signedIn(page, member);

  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(owner.email)).toBeVisible();
  await expect(page.getByRole("main").getByText(member.email)).toBeVisible();
  await expect(page.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Transfer ownership to / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make owner" })).toHaveCount(0);
  expect(harness.requests.some((request) => request.path.endsWith("/rpc/list_business_invitations"))).toBe(false);
  expect(harness.requests.some((request) =>
    /invite_business_member|remove_business_member|revoke_business_invitation/.test(request.path)
  )).toBe(false);
});

test("an account member reaches operational routes and can create orders without a legacy permission row", async ({ page }) => {
  const harness = await appHarness(page, {
    user: member,
    role: "member",
    members: [ownerMember, joinedMember],
  });
  await signedIn(page, member);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Access denied")).toHaveCount(0);

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await expect(page.getByText("Access denied")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add Order/ })).toBeVisible();

  // Operational access is resolved from membership, never by minting a
  // platform role or granular permission row.
  expect(harness.requests.some((request) =>
    request.method !== "GET" && /\/rest\/v1\/(user_roles|user_permissions)$/.test(request.path)
  )).toBe(false);
});

test("an account viewer can view operational routes but stays read-only", async ({ page }) => {
  await appHarness(page, {
    user: viewer,
    role: "viewer",
    members: [ownerMember, { ...joinedMember, user_id: viewer.id, email: viewer.email, full_name: "Viewer A", role: "viewer" }],
  });
  await signedIn(page, viewer);

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await expect(page.getByText("Access denied")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add Order/ })).toHaveCount(0);

  // POS is an operational write module (pos.use): viewer stays denied.
  await page.goto("/pos");
  await expect(page.getByText("Access denied")).toBeVisible();
});

test("an account owner retains operational and management surfaces", async ({ page }) => {
  await appHarness(page, { user: owner, role: "owner", members: [ownerMember, joinedMember] });
  await signedIn(page, owner);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await expect(page.getByText("Access denied")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Members", exact: true })).toBeVisible();
});

test("a signed-in non-member of the active account never reaches operational routes", async ({ page }) => {
  await appHarness(page, {
    user: member,
    role: "member",
    members: [ownerMember],
    initiallyMember: false,
  });
  await signedIn(page, member);

  await page.goto("/");
  await expect(page).toHaveURL(/\/accounts/);
  await expect(page.getByText("Access denied")).toHaveCount(0);
});

test("a verified invitee explicitly accepts and immediately sees the refreshed business context", async ({ page }) => {
  const harness = await appHarness(page, {
    user: invitee,
    role: "member",
    members: [ownerMember],
    initiallyMember: false,
    describe: { status: "pending", business_name: business.name, email_matches: true },
    acceptGrantsMembership: true,
  });
  await signedIn(page, invitee);

  await page.goto("/accounts?invite=invite-token-1");
  await expect(page.getByText("Your invitation is saved. Verification does not accept it or grant access.")).toBeVisible();
  await expect(page.getByText("You're invited to join Biz A Fixture.")).toBeVisible();
  expect(harness.requests.some((request) => request.path.endsWith("/rpc/accept_business_invitation"))).toBe(false);

  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText(/You've joined the business account/)).toBeVisible();

  const accept = harness.requests.find((request) =>
    request.method === "POST" && request.path.endsWith("/rpc/accept_business_invitation")
  );
  expect(accept?.body).toEqual({ p_token: "invite-token-1" });
  await expect(page.getByRole("button", { name: "Biz A Fixture", exact: true })).toBeVisible();
  await expect(page.getByText("You don't belong to a business account yet.")).toHaveCount(0);
  expect(harness.requests.some((request) =>
    request.method !== "GET" && /create-business|signup-provision|\/rest\/v1\/businesses$|\/rest\/v1\/user_roles/.test(request.path)
  )).toBe(false);
});

test("a link issued for another identity never offers or performs acceptance", async ({ page }) => {
  const harness = await appHarness(page, {
    user: invitee,
    role: "member",
    members: [ownerMember],
    initiallyMember: false,
    describe: { status: "pending", business_name: business.name, email_matches: false },
  });
  await signedIn(page, invitee);

  await page.goto("/accounts?invite=invite-token-1");
  await expect(page.getByText("Your invitation is saved. Verification does not accept it or grant access.")).toBeVisible();
  await expect(page.getByText(/different email address/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  expect(harness.requests.some((request) => request.path.endsWith("/rpc/accept_business_invitation"))).toBe(false);
});

test("an already-used link explains itself without accepting again", async ({ page }) => {
  const harness = await appHarness(page, {
    user: invitee,
    role: "member",
    members: [ownerMember],
    initiallyMember: false,
    describe: { status: "accepted", business_name: business.name, email_matches: true },
  });
  await signedIn(page, invitee);

  await page.goto("/accounts?invite=invite-token-1");
  await expect(page.getByText(/You have already joined Biz A Fixture/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  expect(harness.requests.some((request) => request.path.endsWith("/rpc/accept_business_invitation"))).toBe(false);
});
