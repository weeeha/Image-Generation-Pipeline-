import { db, tables } from '../src/db';

const existing = db.select().from(tables.styleTokens).all();
if (existing.length === 0) {
  const value =
    'Cinematic still, painterly realism, muted warm palette, soft directional key light, shallow depth of field, 35mm film grain.';
  const [tok] = db.insert(tables.styleTokens)
    .values({ slug: 'base-style', name: 'Base style', category: 'custom', value, isDefault: true })
    .returning()
    .all();
  db.insert(tables.tokenRevisions).values({ tokenId: tok.id, value }).run();
  console.log('Seeded default style token.');
} else {
  console.log('Tokens exist, skipping.');
}
