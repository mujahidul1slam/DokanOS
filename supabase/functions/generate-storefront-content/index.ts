// Generates storefront marketing content (hero copy, About page, policies)
// using the Lovable AI Gateway with tool calling. Admin-only: generation
// consumes AI credits, so the caller must hold an admin role.
//
// Input:  { name, theme?, accent_hex?, brief?, product_names? }
// Output: { content: { hero_title, hero_subtitle, about_md, policies: {
//           shipping, returns, privacy } } }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Voice guidance per storefront theme (matches storefront.css presets)
const THEME_TONES: Record<string, string> = {
  editorial:
    "Quiet-luxury editorial: refined, restrained, magazine-like prose. Warm, tactile language. Avoid exclamation marks.",
  cinematic:
    "Bold dark cinematic: punchy, confident, after-hours fashion energy. Short commanding lines. Uppercase-friendly.",
  minimal:
    "Clean minimal: precise, modern, zero flourish. Crisp plain statements. Short sentences.",
  warm: "Warm earthy: inviting, human, handcrafted feel. Friendly and grounded language.",
};

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, theme, accent_hex, brief, product_names } = await req.json();
    if (!name || typeof name !== "string") {
      return new Response(JSON.stringify({ error: "Storefront name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Auth: admin only (mirrors team-manage) ----
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabase.auth.getUser(token);
    if (!caller) throw new Error("Unauthorized");
    const { data: callerRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();
    if (callerRole?.role !== "admin") throw new Error("Admin access required");

    // ---- AI gateway ----
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI gateway not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tone = THEME_TONES[String(theme || "editorial").toLowerCase()] || THEME_TONES.editorial;
    const products = Array.isArray(product_names)
      ? product_names.filter((p: unknown) => typeof p === "string" && p.trim()).slice(0, 8)
      : [];

    const systemPrompt = `You are a senior fashion-brand copywriter writing storefront content for a Bangladeshi clothing label.

VOICE: ${tone}
MARKET: Bangladesh (Dhaka). Prices are in BDT. Cash on delivery is common.

BRAND: "${name}"
Accent color: ${typeof accent_hex === "string" ? accent_hex : "n/a"}
${products.length ? `Products include: ${products.join(", ")}. Reference them naturally where useful.` : ""}
${typeof brief === "string" && brief.trim() ? `Operator brief (follow it closely): ${brief.trim()}` : ""}

FIELD RULES:
- hero_title: maximum 6 words. No trailing period. It is the homepage headline.
- hero_subtitle: one sentence, maximum 18 words. Complements the title without repeating it.
- about_md: 2-3 short markdown paragraphs about the brand story and craft. No H1 heading. May use **bold** sparingly.
- policies.shipping: markdown with 3-5 bullet points. Cover: Dhaka delivery 1-2 days, outside Dhaka 2-4 days, nationwide courier, cash on delivery available, delivery charge shown at checkout.
- policies.returns: markdown with 3-4 bullet points. Cover: 7-day exchange window, unworn with tags and original packaging, exchange/size-swap focus rather than refunds, how to start a return (contact support).
- policies.privacy: 2-3 short markdown bullets/paragraphs. Cover: data used only to fulfil orders and delivery, never sold, contact available on request.

Return ONLY a single tool call to "storefront_content". Never wrap content in quotes or code fences.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate storefront content for "${name}".` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "storefront_content",
              description:
                "Storefront marketing content: homepage hero copy, About page markdown, and policy documents.",
              parameters: {
                type: "object",
                properties: {
                  hero_title: { type: "string" },
                  hero_subtitle: { type: "string" },
                  about_md: { type: "string" },
                  policies: {
                    type: "object",
                    properties: {
                      shipping: { type: "string" },
                      returns: { type: "string" },
                      privacy: { type: "string" },
                    },
                    required: ["shipping", "returns", "privacy"],
                    additionalProperties: false,
                  },
                },
                required: ["hero_title", "hero_subtitle", "about_md", "policies"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "storefront_content" } },
      }),
    });

    if (response.status === 429) {
      return new Response(
        JSON.stringify({ error: "AI rate limit reached. Please try again in a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (response.status === 402) {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Add credits in Workspace → Usage." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error", response.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: "AI did not return structured data" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let raw: {
      hero_title?: unknown;
      hero_subtitle?: unknown;
      about_md?: unknown;
      policies?: { shipping?: unknown; returns?: unknown; privacy?: unknown };
    };
    try {
      raw = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool arguments", e, toolCall.function.arguments);
      return new Response(
        JSON.stringify({ error: "AI returned malformed data" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const p = raw.policies || {};
    const content = {
      hero_title: clean(raw.hero_title, 80),
      hero_subtitle: clean(raw.hero_subtitle, 200),
      about_md: clean(raw.about_md, 4000),
      policies: {
        shipping: clean(p.shipping, 2500),
        returns: clean(p.returns, 2500),
        privacy: clean(p.privacy, 2500),
      },
    };

    if (!content.hero_title && !content.about_md) {
      return new Response(
        JSON.stringify({ error: "AI returned empty content" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-storefront-content error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
