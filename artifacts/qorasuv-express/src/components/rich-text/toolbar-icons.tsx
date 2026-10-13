import type { ReactNode } from 'react';

/**
 * Toolbar icons in the Jodit look. Most paths are copied from Jodit 4
 * (https://xdsoft.net/jodit/) so the editor keeps its look without depending on the
 * `jodit` package; the page and box icons are ours. Jodit's licence:
 *
 * The MIT License (MIT)
 * Copyright (c) Valerii Chupurnov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

function Svg({ children, strokeWidth = 2.5 }: { children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const icons = {
  bold: (
    <Svg strokeWidth={2.75}>
      <path d="M6 4h7a4 4 0 0 1 0 8H6V4Zm0 8h8a4 4 0 0 1 0 8H6v-8Z" />
    </Svg>
  ),
  italic: (
    <Svg>
      <path d="M10 4h9M5 20h9M15 4 9 20" />
    </Svg>
  ),
  underline: (
    <Svg>
      <path d="M6 3v8a6 6 0 0 0 12 0V3M4 21h16" />
    </Svg>
  ),
  strikethrough: (
    <Svg>
      <path d="M17 6c-1-1.5-2.5-2-5-2-3 0-5 1.5-5 4 0 1.8 1.5 3 5 4s5 2.2 5 4c0 2.5-2 4-5 4-2.5 0-4-.5-5-2M3 12h18" />
    </Svg>
  ),
  paragraph: (
    <Svg>
      <path d="M20 4H9a5 5 0 0 0 0 10h3M12 4v17M18 4v17" />
    </Svg>
  ),
  ul: (
    <Svg>
      <path
        d="M9.3333 5.3333h12M9.3333 12h12M9.3333 18.6667h12"
        strokeWidth={2.6667}
        strokeLinecap="butt"
      />
      <path d="M4 5.3333h0M4 12h0M4 18.6667h0" strokeWidth={3.2} />
    </Svg>
  ),
  ol: (
    <Svg>
      <path
        d="M10.6667 6.6667h10.6666M10.6667 17.3333h10.6666"
        strokeWidth={2.6667}
        strokeLinecap="butt"
      />
      <path
        d="m2.5 5 2.5-2v7M2.5 10h5M2.5 16a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2.5-5 5h5"
        strokeWidth={2}
      />
    </Svg>
  ),
  link: (
    <Svg>
      <path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8" />
    </Svg>
  ),
  left: (
    <Svg>
      <path
        d="M2.6667 5.3333h18.6666M2.6667 12H16M2.6667 18.6667h18.6666"
        strokeWidth={2.6667}
        strokeLinecap="butt"
      />
    </Svg>
  ),
  center: (
    <Svg>
      <path
        d="M5.3333 5.3333h13.3334M2.6667 12h18.6666M5.3333 18.6667h13.3334"
        strokeWidth={2.6667}
        strokeLinecap="butt"
      />
    </Svg>
  ),
  right: (
    <Svg>
      <path
        d="M2.6667 5.3333h18.6666M8 12h13.3333M2.6667 18.6667h18.6666"
        strokeWidth={2.6667}
        strokeLinecap="butt"
      />
    </Svg>
  ),
  eye: (
    <Svg>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  pencil: (
    <Svg>
      <path d="m4 15 11-11a2.8 2.8 0 0 1 4 4L8 19l-5 2 1-6Zm9-9 4 4" />
    </Svg>
  ),
  unlink: (
    <Svg>
      <path d="m14 5 1-1a3.5 3.5 0 0 1 5 5l-1 1M10 19l-1 1a3.5 3.5 0 0 1-5-5l1-1M4 10l6-6m4 16 6-6" />
    </Svg>
  ),
  justify: (
    <Svg>
      <path
        d="M2.6667 5.3333h18.6666M2.6667 12h18.6666M2.6667 18.6667h18.6666"
        strokeWidth={2.6667}
        strokeLinecap="butt"
      />
    </Svg>
  ),
  symbols: (
    <Svg>
      <path d="M3 17v3h7v-3a7 7 0 1 1 4 0v3h7v-3" />
    </Svg>
  ),
  table: (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </Svg>
  ),
  tableHeader: (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M9 9v12M15 9v12" />
      <rect x="3" y="3" width="18" height="6" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  ),
  // Ours: a big and a small letter A.
  fontSize: (
    <Svg strokeWidth={2.25}>
      <path d="M3 19 9 4l6 15M5.2 14h7.6M15 19l3.5-9 3.5 9M16.2 16h4.6" />
    </Svg>
  ),
  brush: (
    <Svg>
      <path d="M12 3c-2 3.2-5.5 7-5.5 10a5.5 5.5 0 0 0 11 0c0-3-3.5-6.8-5.5-10Z" />
      <rect x="5" y="21" width="14" height="2" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  // A filled sheet: the page background, behind all the text (not one of Jodit's icons).
  page: (
    <Svg strokeWidth={2}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2"
        fill="currentColor"
        opacity="0.3"
        stroke="none"
      />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  ),
  // A framed block with lines of text: the coloured box (not one of Jodit's icons).
  box: (
    <Svg strokeWidth={2}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </Svg>
  ),
  valign: (
    <Svg>
      <path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" />
    </Svg>
  ),
  splitv: (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
    </Svg>
  ),
  merge: (
    <Svg>
      <rect x="2.5" y="4" width="19" height="16" rx="1.5" />
      <path
        d="M12 4v2m0 12v2M3 12h6m-2.5-2.5L9 12l-2.5 2.5M21 12h-6m2.5-2.5L15 12l2.5 2.5"
        strokeWidth={2}
      />
    </Svg>
  ),
  addcolumn: (
    <Svg>
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <path d="M3 12h7M14 12h7m-3.5-3.5v7" />
    </Svg>
  ),
  addrow: (
    <Svg>
      <rect x="3" y="3" width="18" height="7" rx="1" />
      <path d="M12 3v7M12 14v7m-3.5-3.5h7" />
    </Svg>
  ),
  bin: (
    <Svg>
      <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />
    </Svg>
  ),
  eraser: (
    <Svg>
      <path d="m4 12 10-9 7 7-10 10H7l-4-4a3 3 0 0 1 1-4Zm3-3 8 7m-4 4h10" />
    </Svg>
  ),
  undo: (
    <Svg>
      <path d="M9 4 3 10l6 6M3 10h11a7 7 0 0 1 5 12" />
    </Svg>
  ),
  redo: (
    <Svg>
      <path d="m15 4 6 6-6 6m6-6H10a7 7 0 0 0-5 12" />
    </Svg>
  ),
  chevron: (
    <Svg>
      <path d="m4 8 8 8 8-8" />
    </Svg>
  ),
};
