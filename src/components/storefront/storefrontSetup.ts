/**
 * Task 14 (spec §6a step 6): the storefront sub-onboarding's pure logic —
 * "name/slug, theme, payments, publish". ONE shared flow: the onboarding
 * wizard's storefront step and the Storefronts area's "create storefront" both
 * run this (StorefrontSubOnboarding.tsx), never duplicated.
 *
 * Payments here are the creation-time essentials (COD + the two main wallets);
 * the full wallet editor (Rocket, Upay, mCash, per-method fine tuning) lives in
 * the storefront Payments tab and merges over whatever is saved here.
 */

import {
  DEFAULT_PAYMENTS,
  mergeSettings,
  type StorefrontSettings,
} from "@/storefront/lib/settings";

export interface StorefrontSetupValues {
  name: string;
  slug: string;
  theme: string;
  methods: { cod: boolean; bkash: boolean; nagad: boolean };
  codInstructions: string;
  bkashNumber: string;
  bkashInstructions: string;
  nagadNumber: string;
  nagadInstructions: string;
  publishNow: boolean;
}

export const DEFAULT_STOREFRONT_SETUP: StorefrontSetupValues = {
  name: "",
  slug: "",
  theme: "editorial",
  methods: { cod: true, bkash: true, nagad: true },
  codInstructions: "",
  bkashNumber: "",
  bkashInstructions: "",
  nagadNumber: "",
  nagadInstructions: "",
  publishNow: true,
};

/** URL-safe slug: lowercase, hyphenated, trimmed. */
export function slugifyStorefrontName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Creation-time validation. Returns an error message, or null when the values
 * are shippable. At least one payment method must be on — checkout with zero
 * methods cannot take an order (storefront HealthPanel's rule).
 */
export function validateStorefrontSetup(values: StorefrontSetupValues): string | null {
  if (values.name.trim().length === 0) return "Give the storefront a name.";
  if (values.slug.trim().length === 0) return "Give the storefront a URL slug.";
  if (!/^[a-z0-9-]+$/.test(values.slug.trim())) {
    return "The URL slug may only contain lowercase letters, numbers and hyphens.";
  }
  const enabled = Object.values(values.methods).filter(Boolean).length;
  if (enabled === 0) return "Enable at least one payment method (Cash on delivery counts).";
  return null;
}

/**
 * The `storefronts.settings` object written at creation: the chosen checkout
 * methods plus the payment details entered here, over the merged defaults so
 * the stored object always has the full shape (PaymentsTab writes the same
 * shape on later edits).
 */
export function buildStorefrontSettings(values: StorefrontSetupValues): StorefrontSettings {
  return mergeSettings({
    checkout: {
      methods: {
        cod: values.methods.cod,
        bkash: values.methods.bkash,
        nagad: values.methods.nagad,
        rocket: false,
        upay: false,
        mcash: false,
      },
    },
    payments: {
      cod: { instructions: values.codInstructions },
      bkash: {
        ...DEFAULT_PAYMENTS.bkash,
        account_number: values.bkashNumber,
        instructions: values.bkashInstructions,
      },
      nagad: {
        ...DEFAULT_PAYMENTS.nagad,
        account_number: values.nagadNumber,
        instructions: values.nagadInstructions,
      },
    },
  });
}
