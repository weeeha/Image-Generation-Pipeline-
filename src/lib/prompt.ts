const CATEGORY_ORDER = ['palette', 'lighting', 'lens', 'film_stock', 'mood', 'era', 'custom'] as const;

export interface PromptTokenIn { category: (typeof CATEGORY_ORDER)[number]; value: string; }
export interface PromptEntityIn { name: string; type: 'character' | 'prop' | 'setting'; }

const REL_LINE: Record<PromptEntityIn['type'], (n: string) => string> = {
  character: n => `Character reference: ${n} — keep face, hair and costume exactly as shown in the reference images.`,
  prop: n => `Object reference: ${n} — preserve this object's exact design, materials and details.`,
  setting: n => `Location reference: ${n} — preserve this location's layout, architecture and atmosphere.`,
};

export function assemblePrompt(input: {
  tokens: PromptTokenIn[]; entities: PromptEntityIn[];
  scene: string; aspectRatio: string; resolution: string;
}): string {
  const tokenLines = [...input.tokens]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .map(t => t.value);
  const relLines = input.entities.map(e => REL_LINE[e.type](e.name));
  const outputSpec = `Single ${input.resolution} still frame, ${input.aspectRatio} aspect ratio.`;
  return [...tokenLines, ...relLines, input.scene.trim(), outputSpec].filter(Boolean).join('\n');
}
