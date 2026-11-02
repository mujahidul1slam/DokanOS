import SectionRenderer from "./SectionRenderer";
import type { SectionSnapshot } from "../lib/pages";

/** Renders an ordered list of section snapshots (published or draft preview). */
export default function PublishedPageView({ sections }: { sections: SectionSnapshot[] }) {
  return (
    <>
      {sections.map((s, i) => (
        <SectionRenderer key={`${s.type}-${s.position}-${i}`} section={s} />
      ))}
    </>
  );
}
