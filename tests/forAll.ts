import { Rng } from '../src/core/mathx';

/**
 * A property test: a fact that must hold for every input, tried on `cases` inputs drawn from a
 * seeded stream. The same inputs come every run, so the test is as repeatable as one written by
 * hand: it just tries the thousand cases nobody thought to write. A failure names the case and
 * prints the input, so it can be turned into a test of its own.
 */
export function forAll<T>(cases: number, seed: number, make: (rng: Rng, i: number) => T, check: (input: T, i: number) => void): void {
  const rng = new Rng(seed);
  for (let i = 0; i < cases; i++) {
    const input = make(rng, i);
    try {
      check(input, i);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`case ${i} of ${cases} (seed ${seed}) fails: ${why}\ninput: ${JSON.stringify(input)}`, { cause: err });
    }
  }
}
