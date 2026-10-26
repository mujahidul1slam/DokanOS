import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = (match[2] || "").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1]] = val;
  }
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function run() {
  const { data: sf } = await supabase.from("storefronts").select("id, store_id, name, slug").eq("slug", "enveil").single();
  console.log("Storefront:", sf);

  const { data: prods } = await supabase
    .from("products")
    .select("id, name, slug, price, is_active")
    .eq("store_id", sf.store_id)
    .eq("is_active", true)
    .limit(5);
  console.log("Products count:", prods?.length);
  for (const p of prods || []) {
    const { data: vars } = await supabase.from("product_variations").select("id, name, price, attributes").eq("product_id", p.id);
    console.log(`- Product: "${p.name}", slug: "${p.slug}", price: ${p.price}, variations: ${vars?.length || 0}`);
    if (vars?.length) {
      console.log("   variation sample attributes:", JSON.stringify(vars[0].attributes));
    }
  }
}
run();
