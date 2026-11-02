type JsonResponseHeaders = Record<string, string>;

export async function signupGateResponse(
  isOpen: () => Promise<boolean>,
  headers: JsonResponseHeaders = { "Content-Type": "application/json" },
): Promise<Response | null> {
  try {
    if (await isOpen()) return null;
    return new Response(JSON.stringify({
      error: "SIGNUP_CLOSED",
      message: "Sign up is currently closed.",
    }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("signup configuration lookup failed:", error);
    return new Response(JSON.stringify({
      error: "INTERNAL_ERROR",
      message: "Signup configuration unavailable.",
    }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
}
