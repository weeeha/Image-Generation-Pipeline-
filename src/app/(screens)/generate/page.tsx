import { entitiesWithRefs, defaultTokens } from '@/lib/queries';
import { isModelAvailable } from '@/lib/providers';
import { MODELS, type ModelId } from '@/lib/models';
import { ShotComposer, type ModelAvailability } from '@/components/shot-composer';

export const dynamic = 'force-dynamic';

export default function GeneratePage() {
  const entities = [...entitiesWithRefs()].sort((a, b) => a.name.localeCompare(b.name));
  const tokens = defaultTokens().map((t) => ({ id: t.id, name: t.name, value: t.value }));

  // isModelAvailable reads process.env — server-only. Resolved once here and passed down
  // as plain data so the client composer never needs to know how availability is decided.
  const availability = Object.fromEntries(
    (Object.keys(MODELS) as ModelId[]).map((id) => [id, isModelAvailable(id)])
  ) as ModelAvailability;

  return <ShotComposer entities={entities} tokens={tokens} availability={availability} />;
}
