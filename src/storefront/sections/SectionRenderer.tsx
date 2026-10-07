import { useEffect } from "react";
import { registry, isDefaultSectionString, type SectionProps } from "./registry";
import type { SectionSnapshot } from "../lib/pages";

/**
 * Renders one section snapshot. Forward-compatible: an unknown type or props
 * failing validation renders NOTHING (logged) instead of crashing the page.
 */
export default function SectionRenderer({ section }: { section: SectionSnapshot }) {
  const def = registry[section.type];

  useEffect(() => {
    if (!def) {
      console.warn(`[storefront] unknown section type "${section.type}" — skipped`);
      return;
    }
    const errors = def.validate({ ...def.defaultProps, ...(section.props || {}) });
    if (errors.length) {
      console.warn(`[storefront] section "${section.type}" failed validation, skipped:`, errors);
    }
  }, [def, section.type, section.props]);

  if (!def) return null;
  if (section.is_visible === false) return null;

  const props: SectionProps = { ...def.defaultProps, ...(section.props || {}) };
  // Review C4: a section that still carries the registry's own default or its
  // admin label as the title ("Hero"/"Featureda") shows friendlier placeholder
  // copy instead of printing the raw label. The merchant's real copy is never
  // touched — this only swaps leftover labels at render time.
  if (isDefaultSectionString(section.type, "title", props.title)) {
    props.title = def.previewTitle || def.adminLabel;
  }
  if (isDefaultSectionString(section.type, "subtitle", props.subtitle)) {
    props.subtitle = "";
  }
  const errors = def.validate(props);
  if (errors.length) return null;

  const Component = def.component;
  return (
    <section data-sf-anim>
      <Component props={props} />
    </section>
  );
}
