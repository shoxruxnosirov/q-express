import { describe, it, expect } from 'vitest';
import { IMAGE_FORMATS, imageSources, isLowResolution, sizedImage, sourceProblem } from './images';

const stored = 'https://res.cloudinary.com/qorasuv/image/upload/v1712/qorasuv-express/products/abc.webp';

describe('picture formats', () => {
  it('crops products and icons square and the shop background 4:3', () => {
    expect(IMAGE_FORMATS.product).toMatchObject({ aspect: 1, width: 1200, height: 1200 });
    expect(IMAGE_FORMATS.background).toMatchObject({ aspect: 4 / 3, width: 1600, height: 1200 });
    expect(IMAGE_FORMATS.icon).toMatchObject({ aspect: 1, width: 512, height: 512, transparent: true });
  });

  it('warns about a crop well below the stored size, not one just under it', () => {
    const background = IMAGE_FORMATS.background;
    expect(isLowResolution({ x: 0, y: 0, width: 800, height: 600 }, background)).toBe(true);
    expect(isLowResolution({ x: 0, y: 0, width: 1400, height: 1050 }, background)).toBe(false);
    expect(isLowResolution({ x: 0, y: 0, width: 3000, height: 2250 }, background)).toBe(false);
  });

  it('takes any picture a phone gives, and nothing else', () => {
    expect(sourceProblem(new File(['x'], 'a.heic', { type: 'image/heic' }))).toBeNull();
    expect(sourceProblem(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toMatch(/rasm/);
  });
});

describe('sized copies', () => {
  it('asks Cloudinary for a copy of the width needed, in the lightest format', () => {
    expect(sizedImage(stored, 600)).toBe(
      'https://res.cloudinary.com/qorasuv/image/upload/f_auto,q_auto,c_limit,w_600/v1712/qorasuv-express/products/abc.webp',
    );
  });

  it('leaves any other link as it is', () => {
    expect(sizedImage('https://example.com/a.jpg', 600)).toBe('https://example.com/a.jpg');
    expect(sizedImage('blob:http://localhost/123', 600)).toBe('blob:http://localhost/123');
    expect(imageSources('https://example.com/a.jpg', [300, 600])).toEqual({ src: 'https://example.com/a.jpg' });
  });

  it('lists every width for the phone to choose from', () => {
    const { src, srcSet } = imageSources(stored, [300, 600, 1200]);
    expect(src).toContain('w_600/');
    expect(srcSet?.split(', ')).toEqual([
      `${sizedImage(stored, 300)} 300w`,
      `${sizedImage(stored, 600)} 600w`,
      `${sizedImage(stored, 1200)} 1200w`,
    ]);
  });
});
