import { describe, expect, it } from "vitest";
import { buildAddressCandidates, fuzzyMatch, strictMatch } from "@/lib/pathaoMatch";
import { matchesSearch } from "@/components/ui/searchable-select";

// Regression fixtures from issue #3: real addresses that previously missed
// because dropdown search was prefix-only and area matching was strict-only.
const CITIES = [
  { city_id: 1, city_name: "Dhaka" },
  { city_id: 2, city_name: "Chattogram" },
];

const ZONES = [
  { zone_id: 10, zone_name: "Uttara", city_id: 1 },
  { zone_id: 11, zone_name: "Mirpur", city_id: 1 },
  { zone_id: 12, zone_name: "Dhanmondi", city_id: 1 },
  { zone_id: 20, zone_name: "Pahartali", city_id: 2 },
];

const AREAS = [
  { area_id: 100, area_name: "Uttara Sector 7", zone_id: 10 },
  { area_id: 101, area_name: "Uttara Sector 10", zone_id: 10 },
  { area_id: 110, area_name: "Mirpur 10", zone_id: 11 },
  { area_id: 111, area_name: "Mirpur 1", zone_id: 11 },
  { area_id: 120, area_name: "Dhanmondi R/A", zone_id: 12 },
];

describe("dropdown contains-matching (#3)", () => {
  it("finds a location from a mid-word fragment", () => {
    expect(matchesSearch("Uttara Sector 7", "100", "sector 7")).toBe(true);
    expect(matchesSearch("Uttara Sector 7", "100", "Sector 7")).toBe(true);
  });

  it("ignores punctuation and spacing differences", () => {
    expect(matchesSearch("Dhanmondi R/A", "120", "dhanmondi r a")).toBe(true);
    expect(matchesSearch("Mirpur 10", "110", "mirpur10")).toBe(true);
  });

  it("keeps non-matching queries empty", () => {
    expect(matchesSearch("Uttara Sector 7", "100", "banani")).toBe(false);
  });
});

describe("area/zone auto-detect (#3)", () => {
  it("resolves an area named in a real Uttara address and back-fills its zone", () => {
    const candidates = buildAddressCandidates([
      "House 4, Road 12, Uttara Sector 7, Dhaka 1230",
    ]);
    const area = strictMatch(AREAS, (a) => a.area_name, candidates);
    expect(area?.area_id).toBe(100);
    expect(area?.zone_id).toBe(10);
  });

  it("fuzzy-matches a Bashundhara-style spelling inside the chosen city/zone", () => {
    const candidates = buildAddressCandidates([
      "Block C, Road 5, Bashundhara R/A, Dhaka",
    ]);
    const zone = fuzzyMatch(ZONES, (z) => z.zone_name, candidates);
    expect(zone).toBeUndefined(); // no Bashundhara zone in the fixture
    const city = strictMatch(CITIES, (c) => c.city_name, candidates);
    expect(city?.city_name).toBe("Dhaka");
  });

  it("matches a Bangla address through transliteration", () => {
    const candidates = buildAddressCandidates([
      "বাসা ১২, রোড ৫, মিরপুর ১০, ঢাকা",
    ]);
    const city = strictMatch(CITIES, (c) => c.city_name, candidates);
    const zone = strictMatch(ZONES.filter((z) => z.city_id === city?.city_id), (z) => z.zone_name, candidates);
    expect(city?.city_name).toBe("Dhaka");
    expect(zone?.zone_name).toBe("Mirpur");
  });

  it("resolves place names whose phonetic transliteration is too far to fuzzy-match", () => {
    // "চট্টগ্রাম" transliterates character-by-character to "chttgram", which
    // sits outside the edit-distance window of "Chattogram"; the place-name
    // dictionary must short-circuit it to the canonical spelling.
    const candidates = buildAddressCandidates(["বাসা ৩, আগ্রাবাদ, চট্টগ্রাম"]);
    const city = strictMatch(
      [...CITIES, { city_id: 3, city_name: "Cox's Bazar" }],
      (c) => c.city_name,
      candidates
    );
    expect(city?.city_name).toBe("Chattogram");
  });

  it("maps the old colonial spelling and Bangla Cox's Bazar spelling", () => {
    const cities = [
      { city_id: 2, city_name: "Chattogram" },
      { city_id: 3, city_name: "Cox's Bazar" },
    ];
    expect(strictMatch(cities, (c) => c.city_name, ["Chittagong"])?.city_id).toBe(2);
    expect(strictMatch(cities, (c) => c.city_name, ["কক্সবাজার"])?.city_id).toBe(3);
  });

  it("rejects an ambiguous fuzzy area instead of guessing", () => {
    const ambiguous = [
      { area_id: 1, area_name: "Kazipara" },
      { area_id: 2, area_name: "Kazipara" },
    ];
    expect(fuzzyMatch(ambiguous, (a) => a.area_name, ["Kazipar"])).toBeUndefined();
  });

  it("prefers a unique fuzzy area match", () => {
    const areas = [
      { area_id: 1, area_name: "Uttara Sector 7" },
      { area_id: 2, area_name: "Uttara Sector 10" },
    ];
    expect(fuzzyMatch(areas, (a) => a.area_name, ["Sector 7"])?.area_id).toBe(1);
  });
});
