import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toneOf } from '../lib/flowChart.ts';
import { FnTitle } from './FnTitle.tsx';

const shown = (title: string) => render(<p data-testid="t"><FnTitle title={title} /></p>).getByTestId('t');

describe('FnTitle', () => {
  it('draws the tag as a chip in its tone, and keeps the title text whole', () => {
    const el = shown('[Web] Create ER User');
    const tag = el.querySelector('.tag');
    expect(tag).toHaveTextContent('[Web]');
    expect(tag).toHaveClass(`tone-${toneOf('Web')}`);
    expect(el).toHaveTextContent('[Web] Create ER User');
  });

  it('no tag: plain text, no chip', () => {
    const el = shown('Create ER User');
    expect(el.querySelector('.tag')).toBeNull();
    expect(el).toHaveTextContent('Create ER User');
  });

  it('brackets later in the title are not a tag', () => {
    const el = shown('Vet [Admin] case');
    expect(el.querySelector('.tag')).toBeNull();
    expect(el).toHaveTextContent('Vet [Admin] case');
  });

  it('an empty title renders nothing', () => expect(shown('')).toHaveTextContent(''));
});
