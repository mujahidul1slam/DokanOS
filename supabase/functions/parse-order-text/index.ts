// Parses a freeform block of text (typically a customer message) into
// structured order fields using Lovable AI Gateway with tool calling.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: "Provide a text block to parse" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI gateway not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You extract Bangladeshi e-commerce order details from messy customer messages (Bangla, English, or mixed / Banglish).
Return ONLY a single tool call to "extract_order".
- name: full customer name
- phone: 11-digit Bangladeshi mobile starting with 01 if possible. Strip +880 or country code.
- address: full street/house/road/village text WITHOUT city, zone or area names (those go in their own fields).
- city, zone, area: location components if present. Use English spellings (e.g. "Dhaka", "Mirpur", "Section 10").
- product_hints: array of short product names/SKUs/colors/sizes mentioned, each as a separate string.
- shipping_cost, discount, due_amount: numeric BDT values if explicitly mentioned, else null.
- notes: any other instructions (delivery time, gift, color preferences) that don't fit elsewhere.
If a field isn't present, return null. Never invent data.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_order",
                description: "Return structured order fields parsed from the message.",
                parameters: {
                  type: "object",
                  properties: {
                    name: { type: ["string", "null"] },
                    phone: { type: ["string", "null"] },
                    address: { type: ["string", "null"] },
                    city: { type: ["string", "null"] },
                    zone: { type: ["string", "null"] },
                    area: { type: ["string", "null"] },
                    product_hints: {
                      type: "array",
                      items: { type: "string" },
                    },
                    shipping_cost: { type: ["number", "null"] },
                    discount: { type: ["number", "null"] },
                    due_amount: { type: ["number", "null"] },
                    notes: { type: ["string", "null"] },
                  },
                  required: ["product_hints"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_order" } },
        }),
      },
    );

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

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool arguments", e, toolCall.function.arguments);
      return new Response(
        JSON.stringify({ error: "AI returned malformed data" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-order-text error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
