import { describe, it, expect } from 'vitest';
import {
  FONT_SIZES,
  htmlEquals,
  isBlankHtml,
  normalizeHtml,
  preparePastedHtml,
  readableOn,
  sanitizeHtml,
  splitPage,
  stripTableDefaults,
  textColorFor,
  withTableDefaults,
} from './rich-html';

describe('page background padding', () => {
  it('reads a card stored with the earlier 8px as a page background still', () => {
    const old = splitPage('<div style="background-color: #1F6F5C; color: #FFFFFF; padding: 8px;"><p>a</p></div>');
    expect(old.page).toEqual({ backgroundColor: 'rgb(31, 111, 92)', color: 'rgb(255, 255, 255)' });
    expect(old.body).toBe('<p>a</p>');
  });
});

describe('sanitizeHtml', () => {
  it("keeps only the editor's text sizes, and only on runs of text", () => {
    for (const size of FONT_SIZES) {
      expect(sanitizeHtml(`<p><span style="font-size: ${size}">a</span></p>`)).toContain(`font-size: ${size}`);
    }
    // A free size could cover the page or hide a clause.
    for (const size of ['200px', '0.1em', '11pt', '1.6EM ', 'calc(1em*40)', '1.25em !important']) {
      expect(sanitizeHtml(`<p><span style="font-size: ${size}">a</span></p>`)).not.toContain('font-size');
    }
    expect(sanitizeHtml('<p style="font-size: 3em">a</p>')).toBe('<p>a</p>');
    expect(sanitizeHtml('<p><span style="font-size: 1.6em; color: red">a</span></p>')).toContain('font-size: 1.6em');
  });

  it('keeps the formatting the editors produce', () => {
    const html =
      '<h2>Sarlavha</h2><p style="text-align: center">Matn <strong>qalin</strong> <em>kursiv</em> <u>u</u> <s>s</s></p><ul><li><p>bir</p></li></ul><ol><li>ikki</li></ol><blockquote>iqtibos</blockquote>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('drops scripts, event handlers and unsafe tags', () => {
    const out = sanitizeHtml(
      '<p onclick="alert(1)">a</p><script>alert(2)</script><img src=x onerror="alert(3)"><iframe src="https://x.y"></iframe><style>p{}</style>',
    );
    expect(out).toBe('<p>a</p>');
  });

  it('allows only web, mail and phone links', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="data:text/html,hi">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href=" javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="vbscript:x">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="https://mobi.uz">x</a>')).toBe('<a href="https://mobi.uz">x</a>');
    expect(sanitizeHtml('<a href="tel:+998901234567">x</a>')).toBe(
      '<a href="tel:+998901234567">x</a>',
    );
    expect(sanitizeHtml('<a href="mailto:info@mobi.uz">x</a>')).toBe(
      '<a href="mailto:info@mobi.uz">x</a>',
    );
  });

  it('adds rel=noopener to links that open a new tab', () => {
    expect(sanitizeHtml('<a href="https://mobi.uz" target="_blank">x</a>')).toBe(
      '<a href="https://mobi.uz" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="https://mobi.uz" target="_blank" rel="nofollow">x</a>')).toBe(
      '<a href="https://mobi.uz" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
  });

  it('keeps tables: merged cells, header cells, colours, column widths', () => {
    const html =
      '<table style="min-width: 80px"><colgroup><col style="width: 120px"><col></colgroup><tbody><tr><th colspan="2" style="background-color: #FFF2CC; vertical-align: middle">a</th></tr><tr><td rowspan="2" style="text-align: justify">b</td><td>c</td></tr><tr><td>d</td></tr></tbody></table>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps the other blocks: h1, h4, code, rules, list styles', () => {
    const html =
      '<h1>a</h1><h4>b</h4><pre><code>c</code></pre><hr><ul style="list-style-type: square"><li>d</li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps only the CSS the editor writes', () => {
    expect(
      sanitizeHtml(
        '<div style="position:fixed;inset:0;z-index:99999;background:url(https://evil.example/t.png)">x</div>',
      ),
    ).toBe('<div>x</div>');
    expect(sanitizeHtml('<p style="display:none">hidden</p>')).toBe('<p>hidden</p>');
    expect(sanitizeHtml('<p><span style="font-size:0; color: red">a</span></p>')).toBe(
      '<p><span style="color: red;">a</span></p>',
    );
    // Colour only on coloured text (a span) and cells, as the editor writes it.
    expect(sanitizeHtml('<p style="color: red">a</p>')).toBe('<p>a</p>');
    expect(sanitizeHtml('<td style="background-color: expression(alert(1))">a</td>')).not.toContain(
      'expression',
    );
    expect(sanitizeHtml('<p style="color: red !important">a</p>')).toBe('<p>a</p>');
  });

  it('caps merged-cell spans and checks column widths', () => {
    const out = sanitizeHtml(
      '<table><tbody><tr><td colspan="200000" rowspan="0" colwidth="1,2,x">a</td></tr></tbody></table>',
    );
    expect(out).toContain('colspan="50"');
    expect(out).not.toContain('rowspan');
    expect(out).not.toContain('colwidth');
  });

  it('drops data-/aria- attributes, named targets and scheme-less links', () => {
    expect(sanitizeHtml('<p data-href="javascript:x" aria-hidden="true">a</p>')).toBe('<p>a</p>');
    expect(sanitizeHtml('<a href="https://mobi.uz" target="win">x</a>')).toBe(
      '<a href="https://mobi.uz">x</a>',
    );
    expect(sanitizeHtml('<a href="//evil.com">x</a>')).toBe('<a>x</a>');
  });
});

describe('table defaults', () => {
  it('strips only the stored defaults, never text that reads like them', () => {
    const stored = withTableDefaults(
      '<p>border-collapse: collapse; width: 100%; is css</p><table><tbody><tr><td style="color: red;">a</td></tr></tbody></table>',
    );
    expect(stripTableDefaults(stored)).toBe(
      '<p>border-collapse: collapse; width: 100%; is css</p><table><tbody><tr><td style="color: red;">a</td></tr></tbody></table>',
    );
  });

  it('sizes a nested table from its own columns only', () => {
    const out = normalizeHtml(
      '<table><colgroup><col style="width: 100px;"><col style="width: 100px;"></colgroup><tbody><tr><td>' +
        '<table><colgroup><col style="width: 30px;"><col style="width: 90px;"></colgroup><tbody><tr><td>i</td><td>j</td></tr></tbody></table>' +
        '</td><td>b</td></tr></tbody></table>',
    );
    expect((out.match(/<col style="width: [\d.]+%;">/g) ?? []).join('')).toBe(
      '<col style="width: 50%;"><col style="width: 50%;"><col style="width: 25%;"><col style="width: 75%;">',
    );
  });
});

describe('isBlankHtml / normalizeHtml', () => {
  it.each([
    '',
    '<p></p>',
    '<p><br></p>',
    '<p>&nbsp;</p>',
    '  ',
    '<p>&#160;</p>',
    '<p>&nbsp</p>',
    '<p>&zwnj;</p>',
    '<p>​</p>',
    '<hr>',
  ])('treats %j as blank', (h) => {
    expect(isBlankHtml(h)).toBe(true);
    expect(normalizeHtml(h)).toBe('');
  });

  it('gives stored tables inline borders, once, without overriding picked colours', () => {
    const out = normalizeHtml(
      '<table><tbody><tr><td style="border-color: #FF0000">a</td><td>b</td></tr></tbody></table>',
    );
    expect(out).toBe(
      '<table style="border-collapse: collapse; width: 100%;"><tbody><tr><td style="border: 1px solid #dadada; padding: 0.4em; border-color: #FF0000;">a</td><td style="border: 1px solid #dadada; padding: 0.4em;">b</td></tr></tbody></table>',
    );
    expect(normalizeHtml(out)).toBe(out);
  });

  it('stores column widths as percentages of a full-width table, keeping colwidth', () => {
    const editorHtml =
      '<table style="width: 400px;"><colgroup><col style="width: 100px;"><col style="width: 300px;"></colgroup><tbody><tr><td colwidth="100"><p>a</p></td><td colwidth="300"><p>b</p></td></tr></tbody></table>';
    const out = normalizeHtml(editorHtml);
    expect(out).toBe(
      '<table style="border-collapse: collapse; width: 100%;"><colgroup><col style="width: 25%;"><col style="width: 75%;"></colgroup><tbody><tr><td colwidth="100" style="border: 1px solid #dadada; padding: 0.4em;"><p>a</p></td><td colwidth="300" style="border: 1px solid #dadada; padding: 0.4em;"><p>b</p></td></tr></tbody></table>',
    );
    expect(normalizeHtml(out)).toBe(out);
  });

  it('leaves unsized columns auto, dropping the editor min-widths', () => {
    const out = normalizeHtml(
      '<table style="min-width: 80px;"><colgroup><col style="min-width: 40px;"><col style="min-width: 40px;"></colgroup><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
    );
    expect(out).toContain(
      '<table style="border-collapse: collapse; width: 100%;"><colgroup><col><col></colgroup>',
    );
  });

  it('judges emptiness after cleaning, so normalising twice changes nothing', () => {
    const once = normalizeHtml('<table><tr><td><noscript>text</noscript></td></tr></table>');
    expect(once).toBe('');
    expect(normalizeHtml(once)).toBe(once);
  });

  it('keeps text and cleans it', () => {
    expect(isBlankHtml('<p>a</p>')).toBe(false);
    expect(normalizeHtml('<p>a</p><script>x</script>')).toBe('<p>a</p>');
  });
});

describe('second review: style limits, comparison', () => {
  it('sizing styles stay on tables only, within limits', () => {
    expect(sanitizeHtml('<p style="padding: 9999em">a</p>')).toBe('<p>a</p>');
    expect(sanitizeHtml('<p style="width: 50%">a</p>')).toBe('<p>a</p>');
    expect(
      sanitizeHtml(
        '<table><tbody><tr><td style="width: 9999em; min-width: 9999em">a</td></tr></tbody></table>',
      ),
    ).not.toContain('9999');
    expect(
      sanitizeHtml(
        '<table><tbody><tr><td style="border: 9999px solid red">a</td></tr></tbody></table>',
      ),
    ).not.toContain('border');
    const editorTable =
      '<table style="width: 400px; min-width: 80px"><colgroup><col style="width: 100px"></colgroup><tbody><tr><td style="border: 1px solid #dadada; padding: 0.4em">a</td></tr></tbody></table>';
    expect(sanitizeHtml(editorTable)).toBe(editorTable);
  });

  it('text in an invisible colour is refused; a clear cell background is fine', () => {
    for (const c of [
      'transparent',
      'rgba(0, 0, 0, 0)',
      'hsla(0, 0%, 0%, 0)',
      '#0000',
      '#00000000',
    ]) {
      expect(sanitizeHtml(`<p><span style="color: ${c}">a</span></p>`)).toBe('<p>a</p>');
    }
    expect(sanitizeHtml('<p><span style="color: rgba(0, 0, 0, 0.5)">a</span></p>')).toContain(
      'color',
    );
    expect(
      sanitizeHtml(
        '<table><tbody><tr><td style="background-color: transparent">a</td></tr></tbody></table>',
      ),
    ).toContain('background-color');
  });

  it('htmlEquals: equivalent tags and whitespace are equal; code indentation is not', () => {
    expect(htmlEquals('<p><b>a</b>  b</p>', '<p><strong>a</strong> b</p>')).toBe(true);
    expect(htmlEquals('<p>a</p>\n<p>b</p>', '<p>a</p><p>b</p>')).toBe(true);
    expect(htmlEquals('<pre><code>a\n  b</code></pre>', '<pre><code>a\n    b</code></pre>')).toBe(
      false,
    );
    expect(htmlEquals('<p>a</p>', '<p>b</p>')).toBe(false);
  });

  it('pasted links the stored HTML cannot keep become plain text', () => {
    expect(
      preparePastedHtml(
        '<a href="/tariffs">t</a> <a href="ftp://x">f</a> <a href="https://a.uz">ok</a>',
      ),
    ).toBe('t f <a href="https://a.uz">ok</a>');
  });
});

describe('colours', () => {
  const span = (style: string) => sanitizeHtml(`<p><span style="${style}">a</span></p>`);
  const cell = (style: string, inner = 'a') =>
    sanitizeHtml(
      `<table><tbody><tr><td style="${style}"><p>${inner}</p></td></tr></tbody></table>`,
    );

  it('only on coloured text (a span) and cells, as the editor writes them', () => {
    expect(sanitizeHtml('<p style="color: red">a</p>')).toBe('<p>a</p>');
    expect(
      sanitizeHtml('<p><a href="https://a.uz" style="background-color: yellow">a</a></p>'),
    ).toBe('<p><a href="https://a.uz">a</a></p>');
    expect(span('color: red; background-color: #fff2cc')).toBe(
      '<p><span style="color: red; background-color: #fff2cc">a</span></p>',
    );
    expect(span('border-color: red')).toBe('<p>a</p>');
    expect(cell('border-color: red')).toContain('<td style="border-color: red">');
  });

  it('named, short and hsl colours are all read: yellow text on white goes, navy stays', () => {
    for (const c of [
      'yellow',
      '#ff0',
      '#ffff00',
      'hsl(60, 100%, 50%)',
      'rgb(255, 255, 0)',
      'lightgrey',
      'white',
    ]) {
      expect(span(`color: ${c}`)).toBe('<p>a</p>');
    }
    for (const c of ['navy', '#c00', 'hsl(240, 100%, 25%)', 'rgba(0, 0, 0, 0.5)', 'dimgray']) {
      expect(span(`color: ${c}`)).toContain(`color: ${c}`);
    }
  });

  it('a background that follows the theme or the text, or is not a colour, is refused', () => {
    for (const c of ['canvas', 'currentcolor', 'Window', 'nosuchcolour']) {
      expect(span(`background-color: ${c}`)).toBe('<p>a</p>');
    }
  });

  it('text is checked against what it sits on', () => {
    // White text on the white page; dark text on a black cell.
    expect(cell('color: #ffffff')).toContain('<td><p>a</p></td>');
    expect(cell('background-color: #000000')).toContain('<td><p>a</p></td>');
    // Both together read.
    expect(cell('background-color: #000000; color: #ffffff')).toContain(
      '<td style="background-color: #000000; color: #ffffff">',
    );
    // A span sits on its cell: black letters go (the cell's white shows), yellow stay.
    const inCell = cell(
      'background-color: #000000; color: #ffffff',
      '<span style="color: #000000">x</span> <span style="color: #ffff00">y</span>',
    );
    expect(inCell).toContain('<p>x <span');
    expect(inCell).toContain('<span style="color: #ffff00">y</span>');
    // A highlight with the letters on it.
    expect(span('background-color: #000000')).toBe('<p>a</p>');
    expect(span('background-color: #000000; color: #ffffff')).toContain('background-color');
    // Text colour first: white on a white highlight keeps the highlight.
    expect(span('background-color: #ffffff; color: #ffffff')).toBe(
      '<p><span style="background-color: #ffffff;">a</span></p>',
    );
  });

  it('a cleaned value stays as it is on the next clean', () => {
    for (const html of [
      '<p><span style="background-color: #000000">a</span></p>',
      '<p><span style="color: yellow; background-color: navy">a</span></p>',
      '<table><tbody><tr><td style="background-color: #000000; color: #000"><p><span style="color: #fff">a</span></p></td></tr></tbody></table>',
    ]) {
      const once = sanitizeHtml(html);
      expect(sanitizeHtml(once)).toBe(once);
    }
  });

  it('readableOn and textColorFor follow the same rule', () => {
    expect(readableOn(null, null)).toBe(true);
    expect(readableOn('#FFFF00', null)).toBe(false);
    expect(readableOn('#FFFFFF', '#000000')).toBe(true);
    expect(readableOn(null, '#000000')).toBe(false);
    expect(textColorFor('#000000')).toBe('#FFFFFF');
    expect(textColorFor('#FFF2CC')).toBe('#000000');
    expect(textColorFor(null)).toBe('#000000');
  });

  it('paste: colours from outside go, the editor’s own copy and cells keep theirs', () => {
    const docs = preparePastedHtml(
      '<p><span style="color:#f3f4f6;font-weight:700;background-color:transparent">a</span></p>',
    );
    expect(docs).toContain('font-weight:700');
    expect(docs).not.toContain('color');
    expect(preparePastedHtml('<p><span style="background: yellow">a</span></p>')).not.toContain(
      'yellow',
    );
    expect(
      preparePastedHtml('<p data-pm-slice="1 1 []"><span style="color: #cc0000">a</span></p>'),
    ).toContain('color: #cc0000');
    const pastedCell = preparePastedHtml(
      '<table><tr><td style="background-color: #fff2cc; color: #ffffff">a</td></tr></table>',
    );
    expect(pastedCell).toContain('background-color: #fff2cc');
    expect(pastedCell).not.toMatch(/(^|[^-])color: #ffffff/);
  });
});

describe('pasted table colours', () => {
  const td = (out: string, i: number) => out.match(/<td[^>]*>/g)![i];

  it('a dark header row keeps its background, with white text of its own', () => {
    // Google Docs: background on the cell, the white on the text's span.
    const out = preparePastedHtml(
      '<table><tr><td style="background-color:#073763"><p><span style="color:#ffffff">Head</span></p></td></tr><tr><td><p><span style="color:#000000">a</span></p></td></tr></table>',
    );
    expect(td(out, 0)).toBe('<td style="background-color:#073763; color: #FFFFFF;">');
    expect(td(out, 1)).toBe('<td>');
    expect(out).not.toContain('<span style="color');
  });

  it('Word’s `background:` shorthand becomes a background colour, checked like any', () => {
    const out = preparePastedHtml(
      '<table><tr><td style="background:#1F3864;width:100pt"><p><span style="color:white">H</span></p></td><td style="background:url(x.png) no-repeat">i</td></tr><tr><td style="background:yellow">x</td><td style="background:none">y</td></tr></table>',
    );
    expect(out).not.toMatch(/background:/);
    expect(td(out, 0)).toBe(
      '<td style="width:100pt; background-color: rgb(31, 56, 100); color: #FFFFFF;">',
    );
    expect(td(out, 1)).toBe('<td>');
    expect(td(out, 2)).toBe('<td style="background-color: yellow;">');
    expect(td(out, 3)).toBe('<td>');
  });

  it('a table all in one dark background (a dark page) comes without it; a one-row box keeps it', () => {
    const cell = 'style="background-color:#181b21;color:#f3f4f6"';
    const page = preparePastedHtml(
      `<table><tr><td ${cell}>a</td><td ${cell}>b</td></tr><tr><td ${cell}>c</td><td ${cell}>d</td></tr></table>`,
    );
    expect(page).not.toContain('style');
    const box = preparePastedHtml(`<table><tr><td ${cell}>a</td></tr></table>`);
    expect(box).toContain('background-color:#181b21');
    expect(box).toContain('color:#f3f4f6');
  });

  it('a mid or light background keeps the default text; the editor’s own copy is left as it is', () => {
    expect(
      preparePastedHtml('<table><tr><td style="background-color:#6d9eeb">a</td></tr></table>'),
    ).toContain('<td style="background-color:#6d9eeb">');
    const own =
      '<table data-pm-slice="1 1 []"><tbody><tr><td style="background-color: #000000; color: #FFFFFF"><p><span style="color: #FFFF00">a</span></p></td></tr></tbody></table>';
    expect(preparePastedHtml(own)).toBe(own);
  });
});

describe('coloured box (div) styles', () => {
  it('a box keeps its background, text colour, border, padding and corners', () => {
    const box =
      '<div style="padding: 0.6em 0.8em; border-radius: 4px; background-color: #000000; color: #FFFFFF; border: 1px solid #DADADA;"><p>a</p></div>';
    expect(sanitizeHtml(box)).toBe(box);
  });

  it('within limits, and readable like any other colour', () => {
    expect(sanitizeHtml('<div style="border-radius: 100px">a</div>')).toBe('<div>a</div>');
    expect(sanitizeHtml('<div style="border-radius: 50%">a</div>')).toBe('<div>a</div>');
    expect(sanitizeHtml('<div style="padding: 500px">a</div>')).toBe('<div>a</div>');
    // A box (it always has its radius) whose text would not show loses the colour.
    expect(
      sanitizeHtml('<div style="border-radius: 4px; background-color: #000000"><p>a</p></div>'),
    ).toBe('<div style="border-radius: 4px;"><p>a</p></div>');
    expect(sanitizeHtml('<div style="border-radius: 4px; color: #FFFFFF"><p>a</p></div>')).toBe(
      '<div style="border-radius: 4px;"><p>a</p></div>',
    );
    // The page background (only colours) gets readable text instead; white text alone goes.
    expect(sanitizeHtml('<div style="background-color: #000000"><p>a</p></div>')).toBe(
      '<div style="background-color: #000000; color: #FFFFFF;"><p>a</p></div>',
    );
    expect(sanitizeHtml('<div style="color: #FFFFFF"><p>a</p></div>')).toBe('<div><p>a</p></div>');
  });

  it('paste: a div from outside loses its borders and colours', () => {
    expect(
      preparePastedHtml('<div style="border:solid windowtext 1.0pt;padding:1pt"><p>w</p></div>'),
    ).toBe('<div style="padding:1pt;"><p>w</p></div>');
  });
});

describe('hidden text the contrast check must not miss', () => {
  it('a property set twice is judged by the one the browser shows (the last)', () => {
    expect(normalizeHtml('<p><span style="color:#000;color:#fff">a</span></p>')).toBe('<p>a</p>');
    expect(
      normalizeHtml(
        '<table><tbody><tr><td style="background-color:#000;color:#fff;background-color:#fff"><p>a</p></td></tr></tbody></table>',
      ),
    ).not.toContain('color: #fff');
    // Through the page background: not white on white for every line.
    const page = normalizeHtml(
      '<div style="background-color:#000;color:#fff;background-color:#fff"><p>a</p></div>',
    );
    expect(page).not.toMatch(/background-color: rgb\(255, 255, 255\); color: rgb\(255, 255, 255\)/);
    expect(page).toContain('<p>a</p>');
  });

  it('a colour the browser drops is dropped here too, before the check', () => {
    for (const bad of ['rgb(0deg, 0, 0)', 'hsl(0, 0, 0)', 'rgb(50%, 0, 0)', 'rgb(0.0.0, 0, 0)']) {
      expect(
        normalizeHtml(`<p><span style="color: #fff; background-color: ${bad}">a</span></p>`),
      ).toBe('<p>a</p>');
    }
    expect(
      normalizeHtml('<div style="color:#fff; background-color: rgb(0deg,0,0)"><p>a</p></div>'),
    ).toBe('<div><p>a</p></div>');
    // Valid forms still pass.
    expect(sanitizeHtml('<p><span style="color: hsl(240, 100%, 25%)">a</span></p>')).toContain(
      'hsl(240, 100%, 25%)',
    );
    expect(sanitizeHtml('<p><span style="color: rgba(0, 0, 128, 0.9)">a</span></p>')).toContain(
      'rgba(0, 0, 128, 0.9)',
    );
  });

  it('an entity-encoded property name is checked like any other', () => {
    expect(normalizeHtml('<p><span style="&#99;olor: #fff">a</span></p>')).toBe('<p>a</p>');
    expect(normalizeHtml('<p><span style="background-&#99;olor: #000">a</span></p>')).toBe(
      '<p>a</p>',
    );
  });

  it('a coloured span around a block loses its colours', () => {
    expect(
      normalizeHtml('<span style="background-color:#000;color:#fff"><div>a</div></span>'),
    ).not.toContain('color');
    // A span around text only keeps them.
    expect(sanitizeHtml('<p><span style="background-color:#000;color:#fff">a</span></p>')).toBe(
      '<p><span style="background-color:#000;color:#fff">a</span></p>',
    );
  });

  it('spelling stays as written when nothing is dropped', () => {
    expect(sanitizeHtml('<p><span style="color: #ff0000">a</span></p>')).toBe(
      '<p><span style="color: #ff0000">a</span></p>',
    );
  });
});

describe('follow-ups of the review fixes', () => {
  it('a border colour in hsl() or rgb(%) is not read as a width', () => {
    const cell = (border: string) =>
      sanitizeHtml(`<table><tbody><tr><td style="border: ${border}">x</td></tr></tbody></table>`);
    expect(cell('1px double hsl(0, 0%, 50%)')).toContain('border: 1px double hsl(0, 0%, 50%)');
    expect(cell('1px solid rgb(50%, 50%, 50%)')).toContain('border: 1px solid rgb(50%, 50%, 50%)');
    // A real width over the limit still goes.
    expect(cell('50px solid #000')).not.toContain('border');
  });

  it('a page whose own text colour would not show on it gets readable text', () => {
    expect(sanitizeHtml('<div style="background-color: #000; color: #111"><p>x</p></div>')).toBe(
      '<div style="background-color: #000; color: #FFFFFF;"><p>x</p></div>',
    );
    // A readable one stays as written.
    expect(sanitizeHtml('<div style="background-color: #000; color: #fff"><p>x</p></div>')).toBe(
      '<div style="background-color: #000; color: #fff"><p>x</p></div>',
    );
  });

  it('comparing the same values again gives the same answers (cached)', () => {
    const a = '<p><span style="color: #ff0000">a</span></p>';
    const b = '<p><span style="color: rgb(255, 0, 0)">a</span></p>';
    for (let i = 0; i < 3; i += 1) {
      expect(htmlEquals(a, b)).toBe(true);
      expect(htmlEquals(a, '<p>a</p>')).toBe(false);
      expect(htmlEquals(undefined, '')).toBe(true);
    }
  });
});

describe('block tags the editor has no node for', () => {
  it('keep their text apart: h5/h6 → h4, a text block → p, a container is unwrapped', () => {
    expect(normalizeHtml('<h5>Sarlavha</h5><font color="red">qizil</font>')).toBe(
      '<h4>Sarlavha</h4>qizil',
    );
    expect(normalizeHtml('<h6 style="text-align: center">a</h6>')).toBe(
      '<h4 style="text-align: center">a</h4>',
    );
    expect(normalizeHtml('<section><p>a</p><p>b</p></section><article>c</article>')).toBe(
      '<p>a</p><p>b</p><p>c</p>',
    );
    expect(normalizeHtml('<dl><dt>Muddat</dt><dd>7 kun</dd></dl>')).toBe(
      '<p>Muddat</p><p>7 kun</p>',
    );
    // Nothing of the kind is ever stored as it is.
    expect(normalizeHtml('<header><nav>a</nav></header><footer>b</footer>')).not.toMatch(
      /<(header|nav|footer)/,
    );
  });
});

describe('foreign headings where a heading cannot go', () => {
  it('an h5 in a list item stays in the item as text, the list stays whole', () => {
    expect(normalizeHtml('<ul><li><h5>x</h5> tail</li><li>y</li></ul>')).toBe(
      '<ul><li><p>x</p> tail</li><li>y</li></ul>',
    );
  });

  it('an h5 inside another heading is text, and cleaning it again changes nothing', () => {
    const once = sanitizeHtml('<h1><span><h5>x</h5></span></h1>');
    expect(once).not.toContain('<h4>');
    expect(sanitizeHtml(once)).toBe(once);
  });
});
