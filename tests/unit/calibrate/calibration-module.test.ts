import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calibrationModule } from '../../../src/calibrate/calibration-module.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const RECORD_PATH = join(ROOT, 'docs/calibration/resolve-threshold.json');
const MODULE_PATH = join(ROOT, 'src/resolve/calibration.ts');

/**
 * Ties the threshold in force back to the run that measured it (SC-006, FR-016).
 *
 * `tests/unit/calibrate/calibrate-threshold.test.ts` proves the measurement REFUSES to
 * emit a number when the distributions overlap. That is the mechanism. This is the
 * artifact: it proves the module the resolver actually imports was rendered from the
 * committed record rather than typed in.
 *
 * Independent review of these assertions (2026-08-22, T025) found the gap this closes.
 * Every other test asserting the absence of a threshold read `SIMILARITY_THRESHOLD` from
 * `src/resolve/calibration.ts` directly, so hand-editing that file to `0.35` and flipping
 * `separated` to `true` would have produced a number with no run behind it and left the
 * suite green -- the precedent docs/DECISIONS.md's 2026-08-11 correction exists to stop.
 *
 * What this does NOT prove is that the record itself is honest; re-deriving it needs the
 * database and 147 embedding calls, which a unit test must not make. It raises the cost
 * of a fabricated threshold from editing one literal to forging a 147-row record of
 * per-phrase scores, and it makes any drift between the two files a test failure.
 */
describe('src/resolve/calibration.ts (generated)', () => {
  const record = JSON.parse(readFileSync(RECORD_PATH, 'utf-8')) as Parameters<
    typeof calibrationModule
  >[0];

  it('is exactly what the generator renders from the committed calibration record', () => {
    const onDisk = readFileSync(MODULE_PATH, 'utf-8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(calibrationModule(record));
  });

  it('carries no threshold, because the record it came from carries none (FR-018)', () => {
    // Asserted against the record, not against the generated literal: the point is that
    // the null traces to a measurement, not that a null is present.
    expect(record.threshold).toBeNull();
    expect(record.separated).toBe(false);
  });

  it('renders a real threshold when the record has one, so the null is not hardcoded', () => {
    // Without this, the generator could ignore `threshold` entirely and always write
    // null, and the first test would still pass.
    const separated = { ...record, threshold: 0.6123, separated: true };
    const rendered = calibrationModule(separated);

    expect(rendered).toContain('export const SIMILARITY_THRESHOLD: number | null = 0.6123;');
    expect(rendered).toContain('separated: true,');
  });
});
