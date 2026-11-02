import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  isSetupComplete,
  isStepFinished,
  markStep,
  nextUnfinishedKey,
  progressFromRows,
  resumeIndex,
  stepIndexOf,
  stepMark,
  type OnboardingProgress,
} from "./steps";

// Task 13 (spec §6a): the wizard's persistent checklist state machine — what
// skip, resume and completion mean. The page only acts on these decisions.

describe("progressFromRows", () => {
  it("starts with every step open when nothing is persisted", () => {
    const progress = progressFromRows([]);
    expect(progress).toEqual({});
    expect(nextUnfinishedKey(progress)).toBe("business_profile");
    expect(isSetupComplete(progress)).toBe(false);
    expect(resumeIndex(progress)).toBe(0);
  });

  it("maps persisted rows and ignores unknown steps and statuses", () => {
    const progress = progressFromRows([
      { step_key: "business_profile", status: "completed" },
      { step_key: "first_brand", status: "skipped" },
      { step_key: "some_future_step", status: "completed" }, // a newer build's key
      { step_key: "order_sources", status: "bogus" },
    ]);
    expect(progress).toEqual({ business_profile: "completed", first_brand: "skipped" });
    expect(stepMark(progress, "order_sources")).toBeUndefined();
  });

  it("recognizes the Task 14 steps (warehouses → product import → storefront)", () => {
    const progress = progressFromRows([
      { step_key: "warehouses", status: "completed" },
      { step_key: "product_import", status: "skipped" },
      { step_key: "storefront", status: "completed" },
    ]);
    expect(progress).toEqual({
      warehouses: "completed",
      product_import: "skipped",
      storefront: "completed",
    });
  });
});

describe("markStep (skip is one click and persisted as its own mark)", () => {
  it("records a skip distinctly from a completion without touching other steps", () => {
    const progress = markStep({}, "business_profile", "skipped");
    expect(progress).toEqual({ business_profile: "skipped" });
    expect(isStepFinished(progress, "business_profile")).toBe(true);
    expect(progress).not.toHaveProperty("first_brand");
  });

  it("is immutable and overwrites a previous mark on re-run", () => {
    const before: OnboardingProgress = {};
    const done = markStep(before, "first_brand", "completed");
    expect(before).toEqual({});
    const redone = markStep(done, "first_brand", "skipped");
    expect(redone).toEqual({ first_brand: "skipped" });
  });
});

describe("resume (progress persisted per business → resumable after sign-out/in)", () => {
  it("resumes at the first step without a mark", () => {
    const progress = markStep({}, "business_profile", "completed");
    expect(nextUnfinishedKey(progress)).toBe("first_brand");
    expect(resumeIndex(progress)).toBe(stepIndexOf("first_brand"));
  });

  it("walks the Task 14 tail: resume lands on warehouses, then product import, then storefront", () => {
    let progress: OnboardingProgress = {};
    for (const key of ["business_profile", "first_brand", "order_sources"] as const) {
      progress = markStep(progress, key, "completed");
    }
    expect(nextUnfinishedKey(progress)).toBe("warehouses");
    progress = markStep(progress, "warehouses", "completed");
    expect(nextUnfinishedKey(progress)).toBe("product_import");
    progress = markStep(progress, "product_import", "skipped");
    expect(nextUnfinishedKey(progress)).toBe("storefront");
    progress = markStep(progress, "storefront", "skipped");
    expect(isSetupComplete(progress)).toBe(true);
    expect(resumeIndex(progress)).toBe(ONBOARDING_STEPS.length);
  });

  it("resumes past skipped steps and lands on the first truly open one", () => {
    let progress: OnboardingProgress = {};
    progress = markStep(progress, "business_profile", "skipped");
    progress = markStep(progress, "first_brand", "completed");
    expect(nextUnfinishedKey(progress)).toBe("order_sources");
    expect(resumeIndex(progress)).toBe(stepIndexOf("order_sources"));
  });

  it("a skipped step never blocks resume — it is finished, not pending", () => {
    const progress = markStep({}, "business_profile", "skipped");
    expect(isStepFinished(progress, "business_profile")).toBe(true);
    expect(nextUnfinishedKey(progress)).toBe("first_brand");
  });

  it("resume returns to an earlier unfinished step even when later steps are done", () => {
    let progress: OnboardingProgress = {};
    progress = markStep(progress, "order_sources", "completed");
    expect(resumeIndex(progress)).toBe(0);
    expect(nextUnfinishedKey(progress)).toBe("business_profile");
  });
});

describe("completion", () => {
  it("is complete when every step is completed or skipped", () => {
    let progress: OnboardingProgress = {};
    for (const step of ONBOARDING_STEPS) {
      progress = markStep(progress, step.key, step.key === "first_brand" ? "skipped" : "completed");
    }
    expect(isSetupComplete(progress)).toBe(true);
    expect(nextUnfinishedKey(progress)).toBeNull();
    expect(resumeIndex(progress)).toBe(ONBOARDING_STEPS.length);
  });

  it("is incomplete while any step is open", () => {
    let progress: OnboardingProgress = {};
    progress = markStep(progress, "business_profile", "completed");
    progress = markStep(progress, "order_sources", "skipped");
    expect(isSetupComplete(progress)).toBe(false);
  });
});
