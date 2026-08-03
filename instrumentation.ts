export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { sweepStalePending } = await import('@/lib/generate');
    sweepStalePending();
  }
}
