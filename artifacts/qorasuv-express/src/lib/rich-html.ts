import DOMPurify from 'dompurify';

/**
 * Rich-text HTML stored in multilang fields (e.g. a roaming operator's general
 * conditions). The BFF stores the string as-is — no sanitising, no length cap —
 * and the mobile app (and any other page) renders it, so this is the one place
 * the HTML is cleaned: sanitizeHtml on save and before every render; a paste goes
 * through preparePastedHtml (the schema filters it, and saving cleans it).
 */

/** Tags the editor produces; anything else is dropped. */
const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'colgroup',
  'col',
  'span',
  'div',
];

/**
 * Block tags the editor has no node for (written in the HTML tab, or stored by some
 * other tool). Kept by DOMPurify only so foreignBlocks can turn them into ones it
 * has; none of them is ever stored as it is.
 */
const FOREIGN_BLOCKS = [
  'h5',
  'h6',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'address',
  'figure',
  'figcaption',
  'center',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
];

/**
 * `style` carries what the editor writes inline (filtered by STYLE_RULES below);
 * colspan/rowspan/colwidth keep merged cells and dragged column widths; `start`
 * keeps a numbered list's first number ("3." after a paragraph between clauses).
 */
const ALLOWED_ATTR = ['href', 'target', 'rel', 'style', 'colspan', 'rowspan', 'colwidth', 'start'];

/**
 * DOMPurify tests this against most attribute values, not just href, so it keeps the
 * shape of its default: values without a scheme (`_blank`, `noopener`) still pass.
 * Links themselves are held to LINK_PROTOCOL in the hook.
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** A link may only open a web page, mail or the dialler — never `javascript:`, `data:` or `//host`. */
export const LINK_PROTOCOL = /^(https?:\/\/|mailto:|tel:)/i;

/** Above this a merged cell is not a real table but a way to freeze the editor. */
const MAX_SPAN = 50;

/** `rel` words with a meaning for links; anything else is dropped. */
const REL_TOKENS = new Set(['nofollow', 'noopener', 'noreferrer', 'ugc', 'sponsored']);

// Colours in the forms a browser takes: rgb() all numbers or all percentages, hsl()
// with percentages for saturation and lightness, an optional alpha. A colour the
// browser would drop must not pass here, or the contrast check would judge a colour
// that never shows (browserStyles drops whatever still slips through).
const NUM = String.raw`(?:\d{1,3}(?:\.\d+)?|\.\d+)`;
const ALPHA = String.raw`(?:\s*,\s*${NUM}%?)?`;
const COLOR = String.raw`(?:#[0-9a-f]{3,8}|rgba?\(\s*(?:${NUM}\s*,\s*${NUM}\s*,\s*${NUM}|${NUM}%\s*,\s*${NUM}%\s*,\s*${NUM}%)${ALPHA}\s*\)|hsla?\(\s*${NUM}(?:deg)?\s*,\s*${NUM}%\s*,\s*${NUM}%${ALPHA}\s*\)|[a-z]{3,20})`;
const LENGTH = String.raw`(?:0|\d{1,4}(?:\.\d+)?(?:px|em|%))`;
const exact = (source: string) => new RegExp(`^${source}$`, 'i');

/**
 * The text sizes the editor offers, relative to the text around them. The card's
 * own text grows and shrinks with the width it is shown at (rich-text.css), so a
 * size chosen once is big on a wide screen and small on a phone, in proportion.
 * Only these: a free size could cover the page or shrink a clause out of sight.
 */
export const FONT_SIZES = ['0.8em', '1.25em', '1.6em', '2.2em', '3em'] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export function isFontSize(value: unknown): value is FontSize {
  return (FONT_SIZES as readonly unknown[]).includes(value);
}

/**
 * The CSS the editor writes, and nothing else: no `position`, `display`, `url()`,
 * a free `font-size` (only FONT_SIZES)… An unchecked style lets HTML cover the page, hide a clause or load
 * a tracker on the subscriber's phone. A Map, not an object: a property named
 * `constructor` or `__proto__` must find nothing, not Object's own members.
 */
const STYLE_RULES = new Map<string, RegExp>([
  ['text-align', /^(left|right|center|justify|start|end)$/i],
  [
    'list-style-type',
    /^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-latin|upper-latin|lower-roman|upper-roman|lower-greek|none)$/i,
  ],
  ['color', exact(COLOR)],
  ['background-color', exact(COLOR)],
  ['border-color', exact(COLOR)],
  ['vertical-align', /^(top|middle|bottom|baseline)$/i],
  ['width', exact(LENGTH)],
  ['min-width', exact(LENGTH)],
  ['padding', exact(`${LENGTH}(?:\\s+${LENGTH}){0,3}`)],
  ['border', exact(`${LENGTH}\\s+(?:solid|dashed|dotted|double)\\s+${COLOR}`)],
  ['border-collapse', /^(collapse|separate)$/i],
  ['border-radius', exact(LENGTH)],
  ['font-size', /^(?:0\.8em|1\.25em|1\.6em|2\.2em|3em)$/],
]);

/**
 * Where a property may appear.
 * - Sizing: widths on the table and its columns, padding in cells. On text it could
 *   only push a clause out of view, and a cell's own width could push the rest of
 *   its table off a phone screen (the editor sizes columns via <col> and colwidth,
 *   never on cells).
 * - Colour: on the editor's coloured text (<span>), on cells and on its coloured
 *   box (a <div> around paragraphs, with its padding and rounded corners). Nothing
 *   in the editor colours a whole paragraph, link or list; there it would only be
 *   one more way to hide text.
 */
const PLACES = new Map<string, Set<string>>([
  ['width', new Set(['TABLE', 'COL'])],
  ['min-width', new Set(['TABLE', 'COL'])],
  ['padding', new Set(['TD', 'TH', 'DIV'])],
  ['border-radius', new Set(['DIV'])],
  ['color', new Set(['SPAN', 'TD', 'TH', 'DIV'])],
  ['background-color', new Set(['SPAN', 'TD', 'TH', 'DIV'])],
  ['border-color', new Set(['TD', 'TH', 'DIV'])],
  // The editor sizes runs of text, never a whole block.
  ['font-size', new Set(['SPAN'])],
]);

/** Upper bounds per unit, well above anything the editor writes. */
const LIMITS = new Map<string, Record<string, number>>([
  ['width', { px: 5000, em: 100, '%': 100 }],
  ['min-width', { px: 5000, em: 100, '%': 100 }],
  ['padding', { px: 100, em: 5, '%': 10 }],
  ['border', { px: 10, em: 1, '%': 0 }],
  ['border-radius', { px: 24, em: 2, '%': 0 }],
]);

function withinLimits(property: string, value: string): boolean {
  const limits = LIMITS.get(property);
  if (!limits) return true;
  // A border's colour is not a size: `hsl(0, 0%, 50%)` must not read as 50% wide.
  const sizes = property === 'border' ? value.replace(new RegExp(COLOR, 'gi'), '') : value;
  return Array.from(sizes.matchAll(/(\d+(?:\.\d+)?)(px|em|%)/gi)).every(
    ([, n, unit]) => Number(n) <= (limits[unit.toLowerCase()] ?? 0),
  );
}

/** The CSS named colours (`yellow`, `navy`…), as `name:rrggbb`. */
const NAMED_COLORS = new Map(
  [
    'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff',
    'beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff',
    'blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00',
    'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c',
    'cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9',
    'darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b',
    'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000',
    'darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f',
    'darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493',
    'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222',
    'floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc',
    'ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000',
    'greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c',
    'indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5',
    'lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080',
    'lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90',
    'lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa',
    'lightskyblue:87cefa lightslategray:778899 lightslategrey:778899',
    'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6',
    'magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd',
    'mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee',
    'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585',
    'midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5',
    'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23',
    'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98',
    'paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9',
    'peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080',
    'rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513',
    'salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d',
    'silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090',
    'snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080',
    'thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3',
    'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32',
  ]
    .join(' ')
    .split(' ')
    .map((entry) => entry.split(':') as [string, string]),
);

/** A colour as red, green, blue (0–255) and alpha (0–1). */
type Rgba = [number, number, number, number];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function hslToRgb(hue: number, saturation: number, lightness: number): number[] {
  const h = ((hue % 360) + 360) % 360;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [channel(0), channel(8), channel(4)];
}

/**
 * A colour in any form the allowlist takes (hex, rgb(), hsl(), a name), or null.
 * Null also for system colours (`canvas`, `windowtext`…) and `currentcolor`: they
 * follow the reader's theme or the text itself, so nothing here can say whether
 * text in them would show — on a phone, `canvas` text on a `canvas` cell does not.
 */
function parseColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return [0, 0, 0, 0];
  const named = NAMED_COLORS.get(v);
  const hex = /^#([0-9a-f]+)$/.exec(named ? `#${named}` : v)?.[1];
  if (hex) {
    if (![3, 4, 6, 8].includes(hex.length)) return null;
    const pairs = hex.length <= 4 ? [...hex].map((d) => d + d) : hex.match(/../g)!;
    const [r, g, b, a = 255] = pairs.map((p) => parseInt(p, 16));
    return [r, g, b, a / 255];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  const args = fn?.[2].split(',').map((s) => s.trim());
  if (!fn || !args || args.length < 3 || args.length > 4) return null;
  const amount = (s: string, scale: number) =>
    s.endsWith('%') ? (Number.parseFloat(s) / 100) * scale : Number.parseFloat(s);
  const alpha = args[3] === undefined ? 1 : clamp(amount(args[3], 1), 0, 1);
  const rgb = fn[1].startsWith('rgb')
    ? args.slice(0, 3).map((s) => clamp(amount(s, 255), 0, 255))
    : hslToRgb(
        Number.parseFloat(args[0]),
        clamp(Number.parseFloat(args[1]), 0, 100) / 100,
        clamp(Number.parseFloat(args[2]), 0, 100) / 100,
      );
  const color = [...rgb, alpha];
  return color.some(Number.isNaN) ? null : (color as Rgba);
}

/** Text this faint (alpha under one half) is a way to hide a clause, not a style. */
const MIN_TEXT_ALPHA = 0.5;

/**
 * Below this contrast text does not stand out from what is behind it (yellow on
 * white is 1.07, light grey #ccc 1.6, mid grey #999 2.8). Not the 4.5 of WCAG: that
 * is a readability target, and would also strip orange or light-grey notes that
 * an admin may want; this only stops text that is effectively hidden.
 */
const MIN_CONTRAST = 2;

/** The page the HTML is shown on, and its text: the editor's (#222 on white). */
const WHITE: Rgba = [255, 255, 255, 1];
const DEFAULT_TEXT: Rgba = [34, 34, 34, 1];

/** `top` painted over the opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
  1,
];

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgba): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour `bg` would show as on the page (white under it); null is the page. */
const backdrop = (bg: string | null): Rgba => {
  const c = parseColor(bg);
  return c ? over(c, WHITE) : WHITE;
};

/**
 * Whether text in `fg` shows on `bg` by the rule the sanitiser applies; null is the
 * default (dark text, white page). For the editor's colour picker, so it never
 * offers what saving would remove.
 */
export function readableOn(fg: string | null, bg: string | null): boolean {
  const back = backdrop(bg);
  const text = parseColor(fg);
  return contrast(text ? over(text, back) : DEFAULT_TEXT, back) >= MIN_CONTRAST;
}

/** Black or white text, whichever reads better on `bg`. */
export function textColorFor(bg: string | null): string {
  const back = backdrop(bg);
  return contrast([0, 0, 0, 1], back) >= contrast(WHITE, back) ? '#000000' : '#FFFFFF';
}

const COLOR_PROPERTIES = new Set(['color', 'background-color', 'border-color']);

/**
 * The allowed declarations of a style value on `tag`; the value itself when all of
 * them pass.
 */
function cleanStyle(value: string, tag: string): string {
  const parts = value
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  const kept = parts.filter((d) => {
    const colon = d.indexOf(':');
    if (colon < 0) return false;
    const property = d.slice(0, colon).trim().toLowerCase();
    const v = d.slice(colon + 1).trim();
    if (!STYLE_RULES.get(property)?.test(v)) return false;
    const places = PLACES.get(property);
    if (places && !places.has(tag)) return false;
    if (COLOR_PROPERTIES.has(property)) {
      const color = parseColor(v);
      if (!color) return false;
      // Text in an invisible colour hides a clause (a cell background may be clear).
      if (property === 'color' && color[3] < MIN_TEXT_ALPHA) return false;
    }
    return withinLimits(property, v);
  });
  if (kept.length === parts.length) return value.trim();
  return kept.map((d) => `${d};`).join(' ');
}

/** Checks per attribute, on top of DOMPurify's own (tags, attributes, URIs). */
function checkAttribute(name: string, value: string, tag = ''): string | null {
  switch (name) {
    case 'style':
      return cleanStyle(value, tag.toUpperCase()) || null;
    case 'colspan':
    case 'rowspan': {
      if (!/^\d{1,6}$/.test(value.trim())) return null;
      const n = Number(value);
      return n >= 1 ? String(Math.min(n, MAX_SPAN)) : null;
    }
    case 'colwidth':
      return /^\d{1,4}(,\d{1,4}){0,49}$/.test(value) ? value : null;
    case 'start':
      // A numbered list's first number; meaningless anywhere else.
      return tag.toUpperCase() === 'OL' && /^\d{1,4}$/.test(value.trim()) ? value.trim() : null;
    case 'target':
      // Only a new tab; a named window could be reused by another page.
      return value === '_blank' ? value : null;
    case 'rel': {
      const words = value
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => REL_TOKENS.has(w));
      return words.length ? Array.from(new Set(words)).join(' ') : null;
    }
    case 'href':
      return LINK_PROTOCOL.test(value.trim()) ? value.trim() : null;
    default:
      return value;
  }
}

// Lists whose `type` was read during sanitising, waiting for their style.
const listTypes = new WeakMap<Node, string>();

// A private instance: its hooks must not change other DOMPurify users in the bundle.
let purify: ReturnType<typeof DOMPurify> | null = null;
function getPurify() {
  if (purify || typeof window === 'undefined') return purify;
  purify = DOMPurify(window);
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    // A list's old `type` (a, i, …) is not kept, but its look is: noted here, applied
    // once all attributes are done (a later `style` would overwrite it).
    if (data.attrName === 'type' && (node.tagName === 'OL' || node.tagName === 'UL')) {
      const style = listStyleForType(data.attrValue);
      if (style) listTypes.set(node, style);
    }
    const value = checkAttribute(data.attrName, data.attrValue, node.tagName);
    if (value === null) data.keepAttr = false;
    else data.attrValue = value;
  });
  // A link that opens a new tab must not hand the opener to the target page.
  // Its other rel words (nofollow, ugc, sponsored — e.g. from an older text) stay.
  purify.addHook('afterSanitizeAttributes', (node) => {
    const listType = listTypes.get(node);
    if (listType && !(node as HTMLElement).style.listStyleType) {
      (node as HTMLElement).style.listStyleType = listType;
    }
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      const rel = new Set(['noopener', 'noreferrer']);
      (node.getAttribute('rel') ?? '').split(/\s+/).forEach((r) => r && rel.add(r));
      node.setAttribute('rel', [...rel].join(' '));
    }
  });
  return purify;
}

export function sanitizeHtml(html: string): string {
  // On the server (no DOM) nothing can be cleaned, so render nothing rather than
  // pass the raw string through.
  const p = getPurify();
  if (!p?.isSupported) return '';
  const config = {
    ALLOWED_TAGS: [...ALLOWED_TAGS, ...FOREIGN_BLOCKS],
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  };
  // Always a pass on the cleaned DOM (table size limit, <pre>'s leading newline,
  // styles as the browser reads them, contrast). Decided on the DOM, never on the
  // string: `&#99;olor` in an attribute is `color` once parsed.
  // RETURN_DOM: the cleaned document's own <body>, worked on in place — no copy into
  // another document, no second parse (which would drop <pre>'s newline again).
  const body = p.sanitize(html, { ...config, RETURN_DOM: true }) as HTMLElement;
  foreignBlocks(body);
  limitTableSize(body);
  browserStyles(body);
  uncolorSpansAroundBlocks(body);
  readablePage(body);
  fixContrast(body);
  unwrapBareSpans(body);
  return serialize(body);
}

/**
 * Block tags the editor has no node for (FOREIGN_BLOCKS). Dropped with their text
 * kept, one block's text would run into the next one's (`<h5>Sarlavha</h5>qizil` →
 * "Sarlavhaqizil"). So, innermost first: h5/h6 become h4 (the smallest heading the
 * editor has), a block holding only text becomes a paragraph, and one holding other
 * blocks is unwrapped — those stay apart on their own. A style (text-align) goes
 * along; it was checked for its old tag, whose rules are a paragraph's.
 */
function foreignBlocks(root: ParentNode) {
  const blocks = [...Array.from(BREAKING).filter((tag) => tag !== 'BR'), ...FOREIGN_BLOCKS].join(
    ',',
  );
  Array.from(root.querySelectorAll(FOREIGN_BLOCKS.join(',')))
    .reverse()
    .forEach((el) => {
      if (el.querySelector(blocks)) {
        el.replaceWith(...Array.from(el.childNodes));
        return;
      }
      // Not a heading inside a list item or another heading: the editor cannot start a
      // list item with one (it would pull it out and split the list), nor nest them.
      const heading =
        /^H[56]$/.test(el.tagName) && !el.parentElement?.closest('li, h1, h2, h3, h4');
      const to = el.ownerDocument.createElement(heading ? 'h4' : 'p');
      const style = el.getAttribute('style');
      if (style) to.setAttribute('style', style);
      to.append(...Array.from(el.childNodes));
      el.replaceWith(to);
    });
}

/**
 * Styles as a browser applies them: a declaration it rejects (`rgb(0deg, 0, 0)`) is
 * dropped, and of a property set twice only the last valid one stays — the one the
 * browser shows. The contrast check reads one declaration per property, so it must
 * not judge the first of two colours. Rewritten only when something goes, so the
 * stored HTML keeps its own spelling (`#ff0000`) otherwise.
 */
function browserStyles(root: ParentNode) {
  const probe = document.createElement('span');
  root.querySelectorAll('[style]').forEach((el) => {
    const parts = declarations(el);
    const valid = parts.filter((d) => {
      probe.setAttribute('style', d);
      return probe.style.getPropertyValue(property(d)) !== '';
    });
    const kept = valid.filter(
      (d, i) => !valid.slice(i + 1).some((later) => property(later) === property(d)),
    );
    if (kept.length < parts.length) setStyle(el, kept);
  });
}

/**
 * A <span>'s background paints only its own line boxes, not a block inside it, yet
 * the block takes its text colour: white text in a black span around a <div> shows
 * white on white. The editor never nests blocks in a span; such a span loses its
 * colours (its text then follows what is around it, checked as usual).
 */
function uncolorSpansAroundBlocks(root: ParentNode) {
  const blocks = Array.from(BREAKING)
    .filter((tag) => tag !== 'BR')
    .join(',');
  root.querySelectorAll('span[style]').forEach((span) => {
    if (!span.querySelector(blocks)) return;
    setStyle(
      span,
      declarations(span).filter((d) => !['color', 'background-color'].includes(property(d))),
    );
  });
}

/**
 * The page background with no text colour of its own, on which the default dark
 * text would not show (written by hand in the HTML tab): it gets black or white
 * text, as the editor's picker does, rather than losing the background.
 */
function readablePage(root: ParentNode) {
  const page = pageElement(root);
  const background = page?.style.backgroundColor || null;
  if (!page || !background) return;
  // Its own text colour too, when that would not show on it (dark on dark).
  const color = page.style.color || null;
  if (readableOn(color, background)) return;
  setStyle(page, [
    ...declarations(page).filter((d) => property(d) !== 'color'),
    `color: ${textColorFor(background)};`,
  ]);
}

/**
 * A <span> left with no attributes (its colours removed above) shows nothing of its
 * own; kept, the stored HTML would differ from what the editor writes back, and
 * every reload would report a rewrite.
 */
function unwrapBareSpans(root: ParentNode) {
  root.querySelectorAll('span').forEach((span) => {
    if (!span.attributes.length) span.replaceWith(...Array.from(span.childNodes));
  });
}

/**
 * Text that does not stand out from what is behind it — white on white, yellow on a
 * yellow cell, black on black — hides a clause as surely as `display: none`.
 * Walking down from the page (dark text on white), every element that sets a text
 * or background colour is checked against what it sits on. Below MIN_CONTRAST its
 * own text colour goes; if that is not enough, its background too, and what is
 * left is what it sits on, already checked. Elements without colours inherit a
 * checked pair, so they need no check of their own.
 */
function fixContrast(root: ParentNode) {
  const checked = new Map<Element, { fg: Rgba; bg: Rgba }>();
  root.querySelectorAll('[style]').forEach((el) => {
    const parts = declarations(el);
    const own = (name: string) => {
      const d = parts.find((part) => property(part) === name);
      return d ? parseColor(d.slice(d.indexOf(':') + 1).replace(/;$/, '')) : null;
    };
    const ownFg = own('color');
    const ownBg = own('background-color');
    if (!ownFg && !ownBg) return;
    // Document order: whatever this element sits on was checked before it.
    let up = el.parentElement;
    while (up && !checked.has(up)) up = up.parentElement;
    const under = (up && checked.get(up)) || { fg: DEFAULT_TEXT, bg: WHITE };
    let bg = ownBg ? over(ownBg, under.bg) : under.bg;
    let fg = ownFg ? over(ownFg, bg) : under.fg;
    const dropped = new Set<string>();
    if (ownFg && contrast(fg, bg) < MIN_CONTRAST) {
      dropped.add('color');
      fg = under.fg;
    }
    if (ownBg && contrast(fg, bg) < MIN_CONTRAST) {
      dropped.add('background-color');
      bg = under.bg;
    }
    if (dropped.size)
      setStyle(
        el,
        parts.filter((part) => !dropped.has(property(part))),
      );
    checked.set(el, { fg, bg });
  });
}

/**
 * A table whose grid would be far larger than its cells — `colspan="50"` cells over
 * many short rows — makes the editor pad it out to tens of thousands of cells on
 * the first keystroke and freeze. Such a table loses its merges; if it is still
 * like that (ragged rows), its content is kept without the table. A real table,
 * even a big one, has about as many cells as its grid and is left alone.
 */
const MAX_GRID = 2000;

function limitTableSize(root: ParentNode) {
  // Innermost first: a table's rows and cells are its own, not a nested table's.
  Array.from(root.querySelectorAll('table'))
    .reverse()
    .forEach((table) => {
      const rows = Array.from((table as HTMLTableElement).rows);
      const cells = rows.flatMap((row) => Array.from(row.cells));
      const span = (cell: Element, name: string) =>
        Math.max(1, Number(cell.getAttribute(name)) || 1);
      // An upper bound of the grid's width: the widest row, plus everything a
      // rowspan carries into the rows below it.
      const width = () =>
        Math.max(
          0,
          ...rows.map((row) =>
            Array.from(row.cells).reduce((sum, cell) => sum + span(cell, 'colspan'), 0),
          ),
        ) +
        cells
          .filter((cell) => span(cell, 'rowspan') > 1)
          .reduce((sum, cell) => sum + span(cell, 'colspan'), 0);
      const amplified = () => {
        const grid = width() * rows.length;
        return grid > MAX_GRID && grid > 4 * cells.length;
      };
      if (!amplified()) return;
      cells.forEach((cell) => {
        cell.removeAttribute('colspan');
        cell.removeAttribute('rowspan');
        cell.removeAttribute('colwidth');
      });
      if (!amplified()) return;
      table.replaceWith(...cells.flatMap((cell) => Array.from(cell.childNodes)));
    });
}

/**
 * The HTML of a template (or of the <body> sanitizeHtml works on). The parser
 * drops a newline right after <pre> and the
 * serialiser does not put one back, so code that starts with a blank line would
 * lose it on every save; doubling it here keeps it.
 */
function serialize(box: HTMLTemplateElement | HTMLElement): string {
  const root = box instanceof HTMLTemplateElement ? box.content : box;
  root.querySelectorAll('pre').forEach((pre) => {
    const first = pre.firstChild;
    if (first?.nodeType === Node.TEXT_NODE && first.textContent?.startsWith('\n')) {
      first.textContent = `\n${first.textContent}`;
    }
  });
  return box.innerHTML;
}

/**
 * Pasted HTML on its way into the editor. Not sanitizeHtml: the editor's schema
 * keeps only what it knows anyway, and it needs the source's own CSS to read it —
 * Google Docs marks bold, italic and underline with `font-weight`, `font-style`
 * and `text-decoration`, and wraps the whole paste in `<b style="font-weight:normal">`.
 * Stripping those turns the paste all-bold. What the schema would take but must
 * not is fixed here:
 * - a huge colspan/rowspan, which freezes it, is capped;
 * - a link the saved HTML could not keep (`/tariffs`, `ftp://…`, `sms:…`) becomes
 *   plain text now, rather than look like a link and lose its address on save;
 * - Excel's `<col span="3" width="64">` becomes three columns, which the schema reads;
 * - a table the editor would pad out to a huge grid is limited (limitTableSize);
 * - a <br> between blocks becomes the one empty line it shows as;
 * - text colours from outside go, and so do colours that hide text (fixContrast).
 * The stored HTML still goes through sanitizeHtml on save.
 */
export function preparePastedHtml(html: string): string {
  if (
    !/\b(colspan|rowspan|href|span)\s*=|<(table|br)\b|color|background|border/i.test(html) ||
    typeof document === 'undefined'
  ) {
    return html;
  }
  const box = parse(html);
  // Text colours from elsewhere go: Google Docs writes `color: #000000` on every run
  // of text, a dark-mode page its near-white text. Only the editor's own copy (marked
  // data-pm-slice) keeps them, as the admin chose those. Cells keep their colours,
  // checked for contrast below like everything else.
  const fromOutside = !html.includes('data-pm-slice');
  if (fromOutside) {
    box.content.querySelectorAll('[style]').forEach((el) => {
      if (el.tagName === 'TD' || el.tagName === 'TH') return;
      const parts = declarations(el);
      // A <div> with a background or border reads as the editor's coloured box; one
      // from outside (Word's bordered paragraphs) stays plain text.
      const drop = el.tagName === 'DIV' ? PASTE_BOX : PASTE_COLORS;
      const kept = parts.filter((d) => !drop.has(property(d)));
      if (kept.length < parts.length) setStyle(el, kept);
    });
  }
  pastedCellColors(box.content, fromOutside);
  // A <br> standing between blocks (Google Docs writes a blank line that way) is one
  // empty line, as a browser shows it — an empty paragraph to the editor. Left as
  // is, the editor would wrap it in a paragraph of its own and show two lines.
  box.content.querySelectorAll('br').forEach((br) => {
    const parent = br.parentElement;
    if (parent?.matches(TEXT_BLOCKS)) return;
    const near = (node: ChildNode | null, step: 'previousSibling' | 'nextSibling') => {
      while (node && node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
        node = node[step];
      }
      return node;
    };
    const isBlock = (node: ChildNode | null) =>
      isElement(node) && BREAKING.has(node.tagName) && node.tagName !== 'BR';
    if (
      isBlock(near(br.previousSibling, 'previousSibling')) ||
      isBlock(near(br.nextSibling, 'nextSibling'))
    ) {
      br.replaceWith(document.createElement('p'));
    }
  });
  box.content.querySelectorAll('[colspan], [rowspan]').forEach((cell) => {
    (['colspan', 'rowspan'] as const).forEach((name) => {
      const raw = cell.getAttribute(name);
      if (raw === null) return;
      const value = checkAttribute(name, raw);
      if (value === null) cell.removeAttribute(name);
      else cell.setAttribute(name, value);
    });
  });
  box.content.querySelectorAll('a').forEach((a) => {
    if (!LINK_PROTOCOL.test((a.getAttribute('href') ?? '').trim())) {
      a.replaceWith(...Array.from(a.childNodes));
    }
  });
  box.content.querySelectorAll('col[span]').forEach((col) => {
    const span = Math.min(Number(col.getAttribute('span')) || 1, MAX_SPAN);
    col.removeAttribute('span');
    for (let i = 1; i < span; i += 1) col.after(col.cloneNode());
  });
  limitTableSize(box.content);
  browserStyles(box.content);
  uncolorSpansAroundBlocks(box.content);
  fixContrast(box.content);
  return serialize(box);
}

/** What a paste from elsewhere may not colour text with (`background` sets it too). */
const PASTE_COLORS = new Set(['color', 'background-color', 'background']);
const PASTE_BOX = new Set([...PASTE_COLORS, 'border', 'border-color']);

/** A cell's style without the given properties. */
const without = (el: Element, names: string[]) =>
  declarations(el).filter((d) => !names.includes(property(d)));

/**
 * Cell colours in a paste, so a table keeps its look and stays readable:
 * - Word writes a cell's background as `background: #1F3864`. The editor reads the
 *   colour out of it, so it becomes `background-color` here, where the checks below
 *   and fixContrast see it.
 * - From outside, a table whose cells all share one dark background is the source
 *   page's dark theme, not a choice; those backgrounds (and their light text) go.
 * - A dark header row (Google Docs, Word) has its white text on the spans removed
 *   above, which would leave dark text on dark and fixContrast would then drop the
 *   background too. The cell gets black or white text of its own instead.
 */
function pastedCellColors(root: DocumentFragment, fromOutside: boolean) {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('td, th'));
  cells.forEach((cell) => {
    if (!declarations(cell).some((d) => property(d) === 'background')) return;
    // The colour part of the shorthand, as the browser reads it ('' for an image or none).
    const color = cell.style.backgroundColor;
    const rest = without(cell, ['background', 'background-color']);
    setStyle(cell, parseColor(color) ? [...rest, `background-color: ${color};`] : rest);
  });
  if (fromOutside) {
    root.querySelectorAll('table').forEach((table) => {
      const own = Array.from((table as HTMLTableElement).rows).flatMap((row) =>
        Array.from(row.cells),
      );
      const backgrounds = new Set(own.map((cell) => cell.style.backgroundColor));
      const [only] = backgrounds;
      const theme =
        (table as HTMLTableElement).rows.length > 1 &&
        backgrounds.size === 1 &&
        Boolean(only) &&
        !readableOn(null, only);
      if (theme)
        own.forEach((cell) => setStyle(cell, without(cell, ['background-color', 'color'])));
    });
  }
  cells.forEach((cell) => {
    const background = cell.style.backgroundColor || null;
    if (!background || readableOn(cell.style.color || null, background)) return;
    const text = readableOn(null, background) ? [] : [`color: ${textColorFor(background)};`];
    setStyle(cell, [...without(cell, ['color']), ...text]);
  });
}

/**
 * Line breaks, editor ↔ everywhere else. ProseMirror shows an empty paragraph as a
 * line and a paragraph ending in <br> with an extra line; a browser (the read view,
 * the mobile app) shows `<p></p>` as nothing and ignores a final <br>. So what
 * leaves the editor gets one more <br> at the end of such blocks, and what goes
 * into it loses one: the same lines on both sides, and back unchanged.
 */
const TEXT_BLOCKS = 'p, h1, h2, h3, h4';

/** The last child that is not whitespace-only text. */
function lastMeaningful(el: Element): ChildNode | null {
  let node = el.lastChild;
  while (node && node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
    node = node.previousSibling;
  }
  return node;
}

const isBr = (node: ChildNode | null) =>
  node?.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';

/**
 * What a block ends with, looking inside inline formatting: in
 * `<p>a<strong>b<br></strong></p>` the line still ends in that <br>.
 */
function finalLeaf(block: Element): ChildNode | null {
  let node = lastMeaningful(block);
  while (
    node?.nodeType === Node.ELEMENT_NODE &&
    !BREAKING.has((node as Element).tagName) &&
    lastMeaningful(node as Element)
  ) {
    node = lastMeaningful(node as Element);
  }
  return node;
}

/** The editor's HTML as browsers will show it: what onChange hands the form. */
export function fromEditorHtml(html: string): string {
  if (!html || typeof document === 'undefined') return html;
  const box = parse(html);
  box.content.querySelectorAll(TEXT_BLOCKS).forEach((block) => {
    const leaf = finalLeaf(block);
    if (!leaf) block.appendChild(document.createElement('br'));
    else if (isBr(leaf)) leaf.after(document.createElement('br'));
  });
  return serialize(box);
}

/** Stored (browser) HTML as the editor should load it: the reverse of fromEditorHtml. */
export function toEditorHtml(html: string): string {
  if (!html || !/<br/i.test(html) || typeof document === 'undefined') return html;
  const box = parse(html);
  box.content.querySelectorAll(TEXT_BLOCKS).forEach((block) => {
    const leaf = finalLeaf(block);
    if (isBr(leaf)) leaf!.remove();
  });
  return serialize(box);
}

/** Whitespace and invisible characters (nbsp, zero-width, BOM). */
const INVISIBLE = /[\s ​-‍⁠﻿]/g;

/** True when the HTML has no visible text — e.g. the editor's empty `<p></p>`. */
export function isBlankHtml(html?: string): boolean {
  if (!html) return true;
  if (typeof document !== 'undefined') {
    // A <template> parses inertly: no scripts run, no images load.
    const box = document.createElement('template');
    box.innerHTML = html;
    return (box.content.textContent ?? '').replace(INVISIBLE, '') === '';
  }
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&(nbsp|#160|#x0*a0|zwnj|zwj|#8203|#x200b);?/gi, '')
      .replace(INVISIBLE, '') === ''
  );
}

/** Stored form of one language: sanitised, and '' when it carries no text. */
export function normalizeHtml(html?: string): string {
  if (!html) return '';
  // Clean first, then judge emptiness: text only a dropped tag carried (e.g.
  // <noscript>) must not make the result count as non-blank.
  const clean = sanitizeHtml(html);
  if (isBlankHtml(clean)) return '';
  // The editor always keeps an empty paragraph at the end (so the caret can leave a
  // table or heading); stored, it would only add space under the text. Trimmed by
  // a loop, not a regex: an anchored regex over many empty paragraphs is quadratic.
  // Inside the page background, whose </div> would otherwise hide that paragraph.
  const { page, body } = splitPage(clean);
  let out = withTableDefaults(body);
  for (;;) {
    if (out.endsWith('<p></p>')) out = out.slice(0, -'<p></p>'.length);
    else if (out.endsWith('<p><br></p>')) out = out.slice(0, -'<p><br></p>'.length);
    else return joinPage(out, page);
  }
}

/** The whole text's own colours (the page background); null is none of its own. */
export interface PageColors {
  backgroundColor: string | null;
  color: string | null;
}

/** What the page background may set: its colours, and room around the text. */
const PAGE_PROPERTIES = new Set(['background-color', 'color', 'padding']);

/**
 * The text's room inside the page background, as the editor shows it
 * (`.rich-editor .rich-text-editable`) and the read view, so the text does not touch
 * the coloured edge and wraps alike in all three.
 */
// In em, so the room grows with the text (rich-text.css sizes it by the card's
// width); a card stored with the earlier 8px reads the same way.
const PAGE_PADDING = 'padding: 0.6em;';

/**
 * The page background: all the HTML in one <div> that sets only colours (and its
 * padding). Not the coloured box, which always has a radius and a border of its
 * own. Returns its colours and what is in it; else no page and the HTML as it is.
 * Comments, whitespace and <meta> around it are ignored (a browser wraps copied
 * HTML in them).
 */
export function splitPage(html: string): { page: PageColors | null; body: string } {
  const none = { page: null, body: html };
  if (!html || !/color/i.test(html) || typeof document === 'undefined') return none;
  const only = pageElement(parse(html).content);
  if (!only) return none;
  const own = (name: string) => {
    const value = only.style.getPropertyValue(name);
    return parseColor(value) ? value : null;
  };
  const page = { backgroundColor: own('background-color'), color: own('color') };
  if (!page.backgroundColor && !page.color) return none;
  return { page, body: only.innerHTML };
}

/** The page background's <div> in `root` (see splitPage), or null. */
function pageElement(root: ParentNode): HTMLElement | null {
  const nodes = Array.from(root.childNodes).filter(
    (n) =>
      n.nodeType !== Node.COMMENT_NODE &&
      !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) &&
      !(isElement(n) && n.tagName === 'META'),
  );
  const [only] = nodes;
  if (nodes.length !== 1 || !isElement(only) || only.tagName !== 'DIV') return null;
  const parts = declarations(only);
  if (!parts.length || !parts.every((d) => PAGE_PROPERTIES.has(property(d)))) return null;
  return only as HTMLElement;
}

/** The page background's colours as CSS ('' for none); the editor shows them so too. */
export function pageStyle(page: PageColors | null): string {
  // Only real colours go into a style attribute (no quotes, no `;` of their own).
  const valid = (c: string | null | undefined) =>
    c && exact(COLOR).test(c.trim()) ? c.trim() : null;
  const bg = valid(page?.backgroundColor);
  const fg = valid(page?.color);
  return [bg && `background-color: ${bg};`, fg && `color: ${fg};`].filter(Boolean).join(' ');
}

/** `body` inside the page background `page` (the reverse of splitPage). */
export function joinPage(body: string, page: PageColors | null): string {
  const colors = pageStyle(page);
  return body && colors ? `<div style="${colors} ${PAGE_PADDING}">${body}</div>` : body;
}

/** Elements that start their own line: whitespace next to them is never shown. */
const BREAKING = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'COLGROUP',
  'COL',
  'HR',
  'DIV',
  'BR',
]);
/** Inline formatting whose nesting order does not change what is shown. */
const MARKS = new Set(['STRONG', 'EM', 'U', 'S', 'CODE', 'A', 'SPAN']);
const ALIASES: Record<string, string> = { B: 'strong', I: 'em', STRIKE: 's' };

const isElement = (node: Node | null): node is Element => node?.nodeType === Node.ELEMENT_NODE;

/** An element as a sort key: tag and attributes, for ordering nested marks. */
const markKey = (el: Element) =>
  el.tagName + Array.from(el.attributes, (a) => `${a.name}=${a.value}`).join(' ');

/**
 * `<em><strong>x</strong></em>` and `<strong><em>x</em></strong>` show the same:
 * rebuild each chain of single-child marks in one (sorted) order.
 */
function sortMarkChains(parent: Node) {
  Array.from(parent.childNodes).forEach((node) => {
    if (!isElement(node)) return;
    if (!MARKS.has(node.tagName)) {
      sortMarkChains(node);
      return;
    }
    const chain: Element[] = [node];
    let inner: Element = node;
    while (inner.childNodes.length === 1 && isElement(inner.firstChild)) {
      const next = inner.firstChild as Element;
      if (!MARKS.has(next.tagName)) break;
      chain.push(next);
      inner = next;
    }
    const content = Array.from(inner.childNodes);
    if (chain.length > 1) {
      const sorted = [...chain].sort((a, b) => (markKey(a) < markKey(b) ? -1 : 1));
      const shells = sorted.map((el) => el.cloneNode(false) as Element);
      shells.reduce((outer, el) => (outer.appendChild(el), el));
      shells[shells.length - 1].append(...content);
      node.replaceWith(shells[0]);
      inner = shells[shells.length - 1];
    }
    sortMarkChains(inner);
  });
}

/**
 * Whitespace as a browser shows it, line by line across inline formatting: a run
 * of spaces, tabs and newlines is one space; a space right after another (even
 * past a tag, as in `a <code> b</code>`) or at the start or end of a line (a block
 * edge or a <br>) is not shown. Space between words stays — removing it joins
 * words, a real change. Non-breaking spaces are content (browsers keep them), and
 * inside <pre> everything is.
 */
function collapseWhitespace(root: Node) {
  let last: Text | null = null; // the line's last text so far
  let lineStart = true;
  let spaceBefore = false;
  const endLine = () => {
    if (last) {
      last.data = last.data.replace(/ $/, '');
      if (!last.data) last.remove();
    }
    last = null;
    lineStart = true;
    spaceBefore = false;
  };
  const walk = (parent: Node) => {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        text.data = text.data.replace(/[ \t\n\r\f]+/g, ' ');
        if (lineStart || spaceBefore) text.data = text.data.replace(/^ /, '');
        if (!text.data) {
          text.remove();
          return;
        }
        last = text;
        lineStart = false;
        spaceBefore = text.data.endsWith(' ');
      } else if (isElement(node)) {
        if (!BREAKING.has(node.tagName)) {
          walk(node); // inline formatting: the line runs through it
          return;
        }
        endLine();
        if (node.tagName !== 'PRE' && node.tagName !== 'BR') {
          walk(node);
          endLine();
        }
      }
    });
  };
  walk(root);
  endLine();
}

/** A block showing only non-breaking spaces (and <br>s) is an empty line, like <p><br></p>. */
function blankLineAsBr(block: Element) {
  const onlyBreaksAndSpaces = Array.from(block.childNodes).every((node) =>
    node.nodeType === Node.TEXT_NODE ? !(node.textContent ?? '').replace(/[\s ]/g, '') : isBr(node),
  );
  if (!onlyBreaksAndSpaces || !block.textContent?.includes(' ')) return;
  block.replaceChildren(document.createElement('br'));
}

/**
 * The stored form, canonicalised for comparison: what would show the same is
 * written the same. b = strong, i = em, strike = s; styles as the browser reads
 * them; attributes in one order; a <colgroup> that says nothing dropped; empty
 * formatting dropped; nested marks in one order; whitespace as a browser shows
 * it; and a final <br> right after text dropped (browsers ignore it).
 */
// canonical() of recent inputs. The form compares all four languages with their
// unchanged originals on every edit; each comparison sanitises, so the same strings
// would be cleaned again and again. The result depends on the string alone.
const CANONICAL_CACHE_SIZE = 32;
const canonicalCache = new Map<string, string>();

function canonical(html?: string): string {
  const key = html ?? '';
  const hit = canonicalCache.get(key);
  if (hit !== undefined) {
    // Most recently used last, so the oldest is the one dropped.
    canonicalCache.delete(key);
    canonicalCache.set(key, hit);
    return hit;
  }
  const result = computeCanonical(html);
  if (typeof document !== 'undefined') {
    canonicalCache.set(key, result);
    if (canonicalCache.size > CANONICAL_CACHE_SIZE) {
      canonicalCache.delete(canonicalCache.keys().next().value!);
    }
  }
  return result;
}

function computeCanonical(html?: string): string {
  const norm = normalizeHtml(html);
  if (!norm || typeof document === 'undefined') return norm;
  const box = parse(norm);
  const root = box.content;
  root.querySelectorAll('b, i, strike').forEach((el) => {
    const twin = document.createElement(ALIASES[el.tagName]);
    Array.from(el.attributes).forEach((a) => twin.setAttribute(a.name, a.value));
    twin.append(...Array.from(el.childNodes));
    el.replaceWith(twin);
  });
  // Styles as the browser reads them: one format, colours as rgb() (the editor
  // rewrites `#ff0000` as `rgb(255, 0, 0)` on load — the same colour).
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const css = el.style.cssText.trim();
    if (css) el.setAttribute('style', css);
    else el.removeAttribute('style');
  });
  // Attributes in one order: `href target rel` and `target rel href` are one link.
  root.querySelectorAll('*').forEach((el) => {
    const attrs = Array.from(el.attributes, (a) => [a.name, a.value] as const).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    attrs.forEach(([name]) => el.removeAttribute(name));
    attrs.forEach(([name, value]) => el.setAttribute(name, value));
  });
  root.querySelectorAll('colgroup').forEach((group) => {
    if (Array.from(group.children).every((col) => !col.attributes.length)) group.remove();
  });
  collapseWhitespace(root);
  // Formatting with nothing in it shows nothing (innermost first, so nesting empties too).
  Array.from(root.querySelectorAll(Array.from(MARKS).join(',')))
    .reverse()
    .forEach((el) => {
      if (!el.childNodes.length) el.remove();
    });
  sortMarkChains(root);
  root.querySelectorAll(TEXT_BLOCKS).forEach((block) => {
    blankLineAsBr(block);
    // A final <br> after text on the same line shows nothing; after another <br>
    // (or alone) it is an empty line, so it stays.
    const leaf = finalLeaf(block);
    if (isBr(leaf) && leaf!.previousSibling && !isBr(leaf!.previousSibling)) leaf!.remove();
  });
  return serialize(box);
}

/** Whether two HTML values would show and store the same content. */
export function htmlEquals(a?: string, b?: string): boolean {
  return canonical(a) === canonical(b);
}

/**
 * Stored table layout, so a table looks the same wherever the HTML is shown (the
 * mobile app, another page) and not only under this panel's CSS:
 * - the table spans the width (`width: 100%`) and has collapsed borders;
 * - every cell has a border and padding — defaults first, so a colour the admin
 *   picked for a cell still wins;
 * - column widths are percentages, so a table keeps its proportions on any
 *   screen. The editor works in pixels; each cell's `colwidth` keeps those, so
 *   reloading gives the editor back exactly what it had.
 */
const TABLE_DEFAULTS = ['border-collapse: collapse;', 'width: 100%;'];
const CELL_DEFAULTS = ['border: 1px solid #dadada;', 'padding: 0.4em;'];

/** The declarations of an element's style, each with its `;`. */
function declarations(el: Element): string[] {
  return (el.getAttribute('style') ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `${d};`);
}

const property = (declaration: string) => declaration.split(':')[0].trim().toLowerCase();

function setStyle(el: Element, parts: string[]) {
  const css = parts.join(' ').trim();
  if (css) el.setAttribute('style', css);
  else el.removeAttribute('style');
}

const percent = (n: number) => `${Number(n.toFixed(2))}%`;

function parse(html: string) {
  const box = document.createElement('template');
  box.innerHTML = html;
  return box;
}

/** A table's own columns — not those of a table nested in one of its cells. */
function ownCols(table: Element): Element[] {
  return Array.from(table.children)
    .filter((child) => child.tagName === 'COLGROUP')
    .flatMap((group) => Array.from(group.children).filter((c) => c.tagName === 'COL'));
}

/**
 * The reverse of the defaults, for loading stored HTML into the editor, which
 * would otherwise keep them as cell attributes. Done on the DOM, so text that
 * happens to read like CSS is left alone.
 */
export function stripTableDefaults(html: string): string {
  if (!html.includes('<table') || typeof document === 'undefined') return html;
  const box = parse(html);
  const strip = (el: Element, defaults: string[]) =>
    setStyle(
      el,
      declarations(el).filter((d) => !defaults.includes(d.replace(/\s+/g, ' '))),
    );
  box.content.querySelectorAll('table').forEach((t) => strip(t, TABLE_DEFAULTS));
  box.content.querySelectorAll('td, th').forEach((c) => strip(c, CELL_DEFAULTS));
  return serialize(box);
}

export function withTableDefaults(html: string): string {
  if (!html.includes('<table') || typeof document === 'undefined') return html;
  const box = parse(html);
  box.content.querySelectorAll('table').forEach((table) => {
    // The editor's pixel width / min-width give way to the full-width default.
    const own = declarations(table).filter(
      (d) => !['border-collapse', 'width', 'min-width'].includes(property(d)),
    );
    setStyle(table, [...TABLE_DEFAULTS, ...own]);

    const cols = ownCols(table);
    const px = cols.map((col) => {
      const match = /(?:^|;)\s*width:\s*([\d.]+)px/.exec(col.getAttribute('style') ?? '');
      return match ? Number(match[1]) : 0;
    });
    const total = px.reduce((a, b) => a + b, 0);
    const sized = total > 0 && px.every((w) => w > 0);
    cols.forEach((col, i) => {
      const rest = declarations(col).filter(
        (d) => property(d) !== 'min-width' && !/^width\s*:.*px;$/.test(d),
      );
      // All columns sized: pixels become shares of the table; otherwise "auto" stays.
      setStyle(col, sized ? [`width: ${percent((px[i] / total) * 100)};`, ...rest] : rest);
    });
  });
  box.content.querySelectorAll('td, th').forEach((cell) => {
    const own = declarations(cell);
    if (!own.some((d) => property(d) === 'border')) setStyle(cell, [...CELL_DEFAULTS, ...own]);
  });
  return serialize(box);
}

/**
 * The keys (languages) whose HTML differs from `base` by htmlEquals, each with its
 * stored (normalised) form — '' clears it. For a PATCH that only touches what was
 * edited, so a newer value in an untouched key is not overwritten.
 */
export function changedHtml<K extends string>(
  value: Partial<Record<K, string>>,
  base: Partial<Record<K, string>>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  return Object.fromEntries(
    keys.filter((k) => !htmlEquals(value[k], base[k])).map((k) => [k, normalizeHtml(value[k])]),
  ) as Partial<Record<K, string>>;
}

// A Map: `type="constructor"` must find nothing, not an Object member.
const TYPE_STYLES = new Map([
  ['a', 'lower-alpha'],
  ['A', 'upper-alpha'],
  ['i', 'lower-roman'],
  ['I', 'upper-roman'],
  ['disc', 'disc'],
  ['circle', 'circle'],
  ['square', 'square'],
]);

/** The list-style-type an HTML list `type` stands for (`a` → lower-alpha), or null. */
export function listStyleForType(type: string | null): string | null {
  return TYPE_STYLES.get(type ?? '') ?? null;
}
