import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { ReaderProse } from './ReaderProse';

describe('Reader image mapping', () => {
  it('drops unmapped images without shifting the stored indices', () => {
    const { container } = render(
      <ReaderProse
        link={{
          ...makeLink({ id: 'stored/id' }),
          contentHtml:
            '<p>Images</p><img><img src="https://cdn.test/photo.png"><img src="https://cdn.test/overflow.png">',
          contentImageCount: 2,
        }}
      />,
    );
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('src')).toBe('/api/links/stored%2Fid/content-image/1');
    expect(images[0]?.getAttribute('loading')).toBe('lazy');
  });
});
