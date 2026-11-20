import { useId } from 'react';
import { markInner } from './markDrawing.ts';

interface MarkProps {
  className?: string;
  /** Leave out when the name is written next to the mark, so it is not read twice. */
  label?: string;
}

/** The ClinicaLANTERN mark as a crisp inline drawing. Same shapes as public/mark.svg. */
export function Mark({ className, label }: MarkProps) {
  // Gradient names must be unique on the page; React's id is cleaned so it is safe inside url(#...).
  const prefix = 'mk' + useId().replace(/[^a-zA-Z0-9]/g, '') + '-';
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      // The drawing is fixed text from markDrawing.ts. No page data goes into it.
      dangerouslySetInnerHTML={{ __html: markInner(prefix) }}
    />
  );
}
