import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@/lib/prompt';

describe('assemblePrompt', () => {
  it('orders tokens by category, then relationship lines, then scene, then output spec', () => {
    const out = assemblePrompt({
      tokens: [
        { category: 'mood', value: 'Melancholic, quiet dread.' },
        { category: 'palette', value: 'Muted warm palette.' },
      ],
      entities: [
        { name: 'Mara', type: 'character' },
        { name: 'Lantern', type: 'prop' },
      ],
      scene: 'Mara lifts the lantern in the tavern doorway at night.',
      aspectRatio: '21:9', resolution: '2K',
    });
    const idx = (s: string) => out.indexOf(s);
    expect(idx('Muted warm palette.')).toBeLessThan(idx('Melancholic'));
    expect(idx('Melancholic')).toBeLessThan(idx('Character reference: Mara'));
    expect(idx('Character reference: Mara')).toBeLessThan(idx('Object reference: Lantern'));
    expect(idx('Object reference: Lantern')).toBeLessThan(idx('Mara lifts the lantern'));
    expect(out).toContain('21:9');
  });
});
