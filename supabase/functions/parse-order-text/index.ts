// Parses a freeform block of text (typically a customer message) into
// structured order fields using Lovable AI Gateway with tool calling.
// Each field is returned with a confidence score so the client can skip
// uncertain values instead of filling them incorrectly.
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

CRITICAL RULES:
- NEVER guess or invent data. If a field is not clearly present in the text, set its value to null.
- For each extracted field, also return a "confidence" score from 0 to 1:
    1.0  = explicitly and unambiguously stated
    0.7-0.9 = clearly implied / minor formatting cleanup
    0.4-0.6 = uncertain, multiple interpretations
    0.0-0.3 = barely a guess
- If you are below 0.7 confident on a field, RETURN NULL for that field's value (do not fill it).
- Do NOT mix fields. A name should not contain phone digits. An address should not contain the customer name or phone.

FIELD SPEC:
- name: customer's full name only.
- phone: 11-digit Bangladeshi mobile starting with 01. Strip +880 / country codes / spaces / dashes.
- address: street/house/road/village ONLY. Do NOT put city, zone, or area names here.
- city, zone, area: location components if present, English spellings (e.g. "Dhaka", "Mirpur", "Section 10").
- product_hints: array of short product mentions (name, SKU, color, size). Empty array if none.
- shipping_cost, discount, due_amount: numeric BDT values ONLY if explicitly stated. Otherwise null.
- notes: any other instructions (delivery time, gift, color preferences). Null if nothing extra.`;

    const fieldWithConfidence = (valueType: string | string[]) => ({
      type: "object",
      properties: {
        value: { type: Array.isArray(valueType) ? valueType : [valueType, "null"] },
        confidence: { type: "number" },
      },
      required: ["value", "confidence"],
      additionalProperties: false,
    });

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
                description: "Return structured order fields parsed from the message, each with a confidence score.",
                parameters: {
                  type: "object",
                  properties: {
                    name: fieldWithConfidence("string"),
                    phone: fieldWithConfidence("string"),
                    address: fieldWithConfidence("string"),
                    city: fieldWithConfidence("string"),
                    zone: fieldWithConfidence("string"),
                    area: fieldWithConfidence("string"),
                    product_hints: {
                      type: "array",
                      items: { type: "string" },
                    },
                    shipping_cost: fieldWithConfidence("number"),
                    discount: fieldWithConfidence("number"),
                    due_amount: fieldWithConfidence("number"),
                    notes: fieldWithConfidence("string"),
                  },
                  required: [
                    "name", "phone", "address", "city", "zone", "area",
                    "product_hints", "shipping_cost", "discount", "due_amount", "notes",
                  ],
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

    let raw: any;
    try {
      raw = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool arguments", e, toolCall.function.arguments);
      return new Response(
        JSON.stringify({ error: "AI returned malformed data" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Apply confidence threshold: drop any field below 0.7. Cross-validate
    // numeric/string values exist in source text where feasible to catch
    // hallucinations.
    const MIN_CONFIDENCE = 0.7;
    const sourceLower = String(text).toLowerCase();
    const sourceDigits = String(text).replace(/\D/g, "");

    const pick = (
      f: { value: any; confidence: number } | null | undefined,
      validator?: (v: any) => boolean,
    ) => {
      if (!f || f.value === null || f.value === undefined) return null;
      if (typeof f.confidence !== "number" || f.confidence < MIN_CONFIDENCE) return null;
      if (validator && !validator(f.value)) return null;
      return f.value;
    };

    const phoneCheck = (v: string) => {
      const digits = String(v).replace(/\D/g, "");
      // require at least 9 contiguous digits of the phone to appear in the source
      if (digits.length < 9) return false;
      return sourceDigits.includes(digits.slice(-9));
    };

    const numberCheck = (v: number) => {
      // require the number to literally appear in the source (avoid invented totals)
      const s = String(Math.round(v));
      return sourceDigits.includes(s) || sourceLower.includes(s);
    };

    const stringInSource = (v: string) => {
      // Accept if any 4+ char token of value appears in source (loose, since
      // address transliteration may differ). Skip for very short values.
      const tokens = String(v).toLowerCase().split(/[\s,./-]+/).filter((t) => t.length >= 4);
      if (tokens.length === 0) return true;
      return tokens.some((t) => sourceLower.includes(t));
    };

    const parsed = {
      name: pick(raw.name),
      phone: pick(raw.phone, phoneCheck),
      address: pick(raw.address, stringInSource),
      city: pick(raw.city),
      zone: pick(raw.zone),
      area: pick(raw.area),
      product_hints: Array.isArray(raw.product_hints) ? raw.product_hints : [],
      shipping_cost: pick(raw.shipping_cost, numberCheck),
      discount: pick(raw.discount, numberCheck),
      due_amount: pick(raw.due_amount, numberCheck),
      notes: pick(raw.notes),
    };

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
