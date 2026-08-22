import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentOrchestrationClient } from '../src/agent-orchestration/agent-orchestration.client.js';
import {
  calibrate,
  MATCHING_BASELINE,
  type ConceptVector,
  type PhraseSample,
} from '../src/calibrate/calibrate-threshold.js';
import { samplePhrases, type SourceChunk } from '../src/calibrate/phrase-sampling.js';
import { NON_CONCEPT_IDS } from '../src/corpus/non-concept-ids.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { calibrationModule } from '../src/calibrate/calibration-module.js';

/**
 * Runs the calibration FR-016 to FR-019b describe, against the real corpus.
 *
 * TypeScript rather than the `corpus/tools/calibrate_threshold.py` tasks.md names,
 * because the inputs are concept vectors and stored chunks -- both in Postgres -- and
 * specs/005-corpus-ingest-foundation/research.md §1 settled that no Python process in
 * this repository connects to the database. Adding one here to satisfy a filename would
 * reopen exactly the question that decision closed.
 *
 *   node --import ./scripts/register-ts-node.mjs scripts/calibrate-threshold.ts
 *   node --import ./scripts/register-ts-node.mjs scripts/calibrate-threshold.ts --phrases-only
 *
 * `--phrases-only` prints the sampled phrases and makes no provider call, so the sample
 * can be read before anything is embedded.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RECORD_PATH = join(ROOT, 'docs/calibration/resolve-threshold.json');
const MODULE_PATH = join(ROOT, 'src/resolve/calibration.ts');

/** Three per concept: enough to see a spread, small enough to read all of them. */
const PHRASES_PER_CONCEPT = 3;
/** The agent service accepts at most 256 texts per call (agent_service/schemas.py). */
const EMBED_BATCH = 200;

interface ConceptRow {
  conceptId: string;
  name: string;
  hasCorpus: boolean;
  embedding: string | null;
}

async function main() {
  const phrasesOnly = process.argv.includes('--phrases-only');
  const prisma = new PrismaClient();

  try {
    const concepts = (
      await prisma.$queryRaw<ConceptRow[]>`
        SELECT concept_id AS "conceptId", name, has_corpus AS "hasCorpus", embedding::text AS embedding
        FROM concepts
        ORDER BY concept_id
      `
    ).filter((row) => !NON_CONCEPT_IDS.has(row.conceptId));

    const withVectors: ConceptVector[] = concepts
      .filter((row) => row.embedding !== null)
      .map((row) => ({
        conceptId: row.conceptId,
        hasCorpus: row.hasCorpus,
        vector: JSON.parse(row.embedding!) as number[],
      }));
    const missingVectors = concepts.length - withVectors.length;

    // Masked out of every phrase: the concept's name and each recorded way of naming it.
    // Reading `concept_terms` to *remove* its content is the opposite of the circularity
    // FR-017 forbids -- what it forbids is drawing phrases from there.
    const terms = await prisma.conceptTerm.findMany({
      select: { conceptId: true, displayTerm: true },
      orderBy: { term: 'asc' },
    });
    const maskByConcept = new Map<string, string[]>();
    for (const concept of concepts) maskByConcept.set(concept.conceptId, [concept.name]);
    for (const term of terms) {
      const list = maskByConcept.get(term.conceptId);
      if (list && !list.includes(term.displayTerm)) list.push(term.displayTerm);
    }

    const chunks = await prisma.docChunk.findMany({
      select: { chunkId: true, patternId: true, headingPath: true, content: true },
      orderBy: { chunkId: 'asc' },
    });
    const chunksByConcept = new Map<string, SourceChunk[]>();
    for (const chunk of chunks) {
      const list = chunksByConcept.get(chunk.patternId) ?? [];
      list.push({ chunkId: chunk.chunkId, headingPath: chunk.headingPath, content: chunk.content });
      chunksByConcept.set(chunk.patternId, list);
    }

    const sampled: Array<{ conceptId: string; phrase: string }> = [];
    const noPhrases: string[] = [];
    for (const concept of concepts) {
      const own = chunksByConcept.get(concept.conceptId) ?? [];
      const phrases = samplePhrases(
        { conceptId: concept.conceptId, mask: maskByConcept.get(concept.conceptId) ?? [], chunks: own },
        PHRASES_PER_CONCEPT,
      );
      if (phrases.length === 0 && concept.hasCorpus) noPhrases.push(concept.conceptId);
      for (const phrase of phrases) sampled.push({ conceptId: concept.conceptId, phrase });
    }

    console.log(
      `[calibrate] ${concepts.length} concepts (${withVectors.filter((c) => c.hasCorpus).length} with material, ` +
        `${withVectors.filter((c) => !c.hasCorpus).length} grey, ${missingVectors} without a vector), ` +
        `${sampled.length} phrases from ${new Set(sampled.map((s) => s.conceptId)).size} concepts`,
    );
    if (noPhrases.length > 0) {
      console.log(`[calibrate] no usable phrase found for: ${noPhrases.join(', ')}`);
    }

    if (phrasesOnly) {
      for (const row of sampled) console.log(`  ${row.conceptId.padEnd(34)} ${row.phrase}`);
      return;
    }

    const client = new AgentOrchestrationClient();
    const vectors: number[][] = [];
    for (let i = 0; i < sampled.length; i += EMBED_BATCH) {
      const batch = sampled.slice(i, i + EMBED_BATCH);
      console.log(`[calibrate] embedding phrases ${i + 1}-${i + batch.length}...`);
      vectors.push(...(await client.embed(batch.map((row) => row.phrase))));
    }

    const samples: PhraseSample[] = sampled.map((row, i) => ({ ...row, vector: vectors[i] }));
    const result = calibrate(samples, withVectors);

    const show = (label: string, d: { n: number; min: number; p5: number; p50: number; p95: number; max: number; mean: number }) =>
      console.log(
        `  ${label.padEnd(28)} n=${String(d.n).padStart(4)}  min ${f(d.min)}  p5 ${f(d.p5)}  ` +
          `p50 ${f(d.p50)}  p95 ${f(d.p95)}  max ${f(d.max)}  mean ${f(d.mean)}`,
      );

    console.log('\n[calibrate] distributions');
    show('matching (own concept)', result.matching);
    show('non-matching (material)', result.nonMatching);
    show('non-matching (grey)', result.nonMatchingGrey);
    console.log(
      `\n[calibrate] separation p5(matching) - p95(non-matching) = ${f(result.separation)}  ` +
        `-> ${result.separated ? 'separated' : 'NOT separated'}`,
    );
    if (result.overlap) console.log(`[calibrate] ${result.overlap}`);
    if (result.threshold !== null) console.log(`[calibrate] threshold = ${f(result.threshold)}`);

    // How often a grey concept out-scores every concept with material for a phrase that
    // belongs to a concept with material. This is FR-010's evidence: if it is common,
    // grey vectors cannot be judged on the same footing.
    const greyHijacks = result.scored.filter(
      (row) => Number.isFinite(row.bestGreyScore) && row.bestGreyScore > row.bestOtherScore,
    );
    const greyBeatsOwn = result.scored.filter(
      (row) => Number.isFinite(row.bestGreyScore) && row.bestGreyScore > row.ownScore,
    );
    console.log(
      `[calibrate] grey: out-scores the best material non-match for ${greyHijacks.length}/${result.scored.length} phrases, ` +
        `out-scores the phrase's own concept for ${greyBeatsOwn.length}/${result.scored.length}`,
    );
    if (result.threshold !== null) {
      const greyAbove = result.scored.filter((row) => row.bestGreyScore > result.threshold!).length;
      console.log(
        `[calibrate] grey: ${greyAbove}/${result.scored.length} phrases have a grey concept above the threshold`,
      );
    }

    // The plainest reading of the same data: how often the concept a phrase was taken
    // from is the strongest match for it. A threshold cannot rescue a phrase whose own
    // concept is not even top of the list.
    const topOne = result.scored.filter((row) => row.ownScore > row.bestOtherScore).length;
    console.log(
      `[calibrate] own concept is the strongest material match for ${topOne}/${result.scored.length} phrases ` +
        `(${((100 * topOne) / Math.max(1, result.scored.length)).toFixed(0)}%)`,
    );

    const record = {
      calibratedAt: new Date().toISOString(),
      baseline: MATCHING_BASELINE,
      isFloor: result.isFloor,
      phrasesPerConcept: PHRASES_PER_CONCEPT,
      materialConcepts: result.materialConcepts,
      greyConcepts: result.greyConcepts,
      matching: round(result.matching),
      nonMatching: round(result.nonMatching),
      nonMatchingGrey: round(result.nonMatchingGrey),
      greyMatching: result.greyMatching,
      separation: round4(result.separation),
      separated: result.separated,
      threshold: result.threshold === null ? null : round4(result.threshold),
      overlap: result.overlap,
      ownConceptIsTopMaterialMatch: { count: topOne, ofPhrases: result.scored.length },
      greyEvidence: {
        outScoresBestMaterialNonMatch: greyHijacks.length,
        outScoresOwnConcept: greyBeatsOwn.length,
        ofPhrases: result.scored.length,
      },
      scored: result.scored.map((row) => ({
        conceptId: row.conceptId,
        phrase: row.phrase,
        ownScore: round4(row.ownScore),
        bestOtherConceptId: row.bestOtherConceptId,
        bestOtherScore: round4(row.bestOtherScore),
        bestGreyConceptId: row.bestGreyConceptId,
        bestGreyScore: round4(row.bestGreyScore),
      })),
    };

    mkdirSync(dirname(RECORD_PATH), { recursive: true });
    writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
    console.log(`[calibrate] wrote ${RECORD_PATH}`);

    writeFileSync(MODULE_PATH, calibrationModule(record), 'utf-8');
    console.log(`[calibrate] wrote ${MODULE_PATH}`);
  } finally {
    await prisma.$disconnect();
  }
}

function f(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function round4(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : null;
}

function round(d: { n: number; min: number; p5: number; p50: number; p95: number; max: number; mean: number }) {
  return {
    n: d.n,
    min: round4(d.min),
    p5: round4(d.p5),
    p50: round4(d.p50),
    p95: round4(d.p95),
    max: round4(d.max),
    mean: round4(d.mean),
  };
}

void main();
