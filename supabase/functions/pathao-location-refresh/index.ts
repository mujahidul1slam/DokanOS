import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PATHAO_BASE = "https://api-hermes.pathao.com";

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("PATHAO_CLIENT_ID"),
      client_secret: Deno.env.get("PATHAO_CLIENT_SECRET"),
      username: Deno.env.get("PATHAO_USERNAME"),
      password: Deno.env.get("PATHAO_PASSWORD"),
      grant_type: "password",
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pathao auth failed [${res.status}]: ${txt}`);
  }
  const data = await res.json();
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = await getAccessToken();

    // 1. Fetch & upsert cities
    const citiesRes = await fetch(`${PATHAO_BASE}/aladdin/api/v1/countries/1/city-list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const citiesData = await citiesRes.json();
    const cities = citiesData.data?.data || citiesData.data || [];

    if (cities.length > 0) {
      await sb.from("pathao_cities").upsert(
        cities.map((c: any) => ({
          city_id: c.city_id,
          city_name: c.city_name,
          fetched_at: new Date().toISOString(),
        })),
        { onConflict: "city_id" }
      );
    }

    // 2. Fetch zones for each city
    let totalZones = 0;
    for (const city of cities) {
      try {
        const zonesRes = await fetch(`${PATHAO_BASE}/aladdin/api/v1/cities/${city.city_id}/zone-list`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const zonesData = await zonesRes.json();
        const zones = zonesData.data?.data || zonesData.data || [];
        if (zones.length > 0) {
          await sb.from("pathao_zones").upsert(
            zones.map((z: any) => ({
              zone_id: z.zone_id,
              zone_name: z.zone_name,
              city_id: city.city_id,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "zone_id" }
          );
          totalZones += zones.length;
        }
      } catch (e) {
        console.error(`Failed zones for city ${city.city_id}:`, e);
      }
    }

    // 3. Fetch areas for each zone (from DB since we just updated)
    const { data: allZones } = await sb.from("pathao_zones").select("zone_id");
    let totalAreas = 0;
    for (const zone of allZones || []) {
      try {
        const areasRes = await fetch(`${PATHAO_BASE}/aladdin/api/v1/zones/${zone.zone_id}/area-list`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const areasData = await areasRes.json();
        const areas = areasData.data?.data || areasData.data || [];
        if (areas.length > 0) {
          await sb.from("pathao_areas").upsert(
            areas.map((a: any) => ({
              area_id: a.area_id,
              area_name: a.area_name,
              zone_id: zone.zone_id,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "area_id" }
          );
          totalAreas += areas.length;
        }
      } catch (e) {
        console.error(`Failed areas for zone ${zone.zone_id}:`, e);
      }
    }

    const summary = { cities: cities.length, zones: totalZones, areas: totalAreas };
    console.log("Pathao location refresh complete:", summary);

    return new Response(JSON.stringify({ data: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("pathao-location-refresh error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
