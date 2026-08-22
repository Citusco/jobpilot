import { PrismaClient } from '../../src/generated/prisma/client.js';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

describe('concepts/doc_chunks migration shape (contract)', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the concepts table with the expected columns and nullability', async () => {
    const columns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'concepts'
      ORDER BY ordinal_position
    `;
    const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));

    expect(byName['concept_id']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['name']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['aliases']).toBeUndefined(); // moved to concept_terms (data-model.md)
    expect(byName['kind']).toMatchObject({ data_type: 'USER-DEFINED', is_nullable: 'NO' });
    expect(byName['related']).toMatchObject({ data_type: 'ARRAY', is_nullable: 'YES' });
    expect(byName['has_corpus']).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
    expect(byName['embedding']).toMatchObject({ is_nullable: 'YES' });
    expect(byName['status']).toMatchObject({ data_type: 'USER-DEFINED', is_nullable: 'NO' });
    expect(byName['added_from']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['created_at']).toMatchObject({ is_nullable: 'NO' });
    expect(byName['updated_at']).toMatchObject({ is_nullable: 'NO' });
  });

  it('creates the doc_chunks table with the expected columns and nullability', async () => {
    const columns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'doc_chunks'
      ORDER BY ordinal_position
    `;
    const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));

    expect(byName['chunk_id']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['pattern_id']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['kind']).toBeUndefined(); // the kind subsystem is abolished (docs/DECISIONS.md 2026-08-10)
    expect(byName['label']).toBeUndefined();
    expect(byName['context_prefix']).toBeUndefined();
    expect(byName['kind_confidence']).toBeUndefined();
    expect(byName['heading_path']).toMatchObject({ data_type: 'ARRAY', is_nullable: 'YES' });
    expect(byName['parent_chunk_id']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName['source_offset']).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
    expect(byName['source_length']).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
    expect(byName['content']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['source_url']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['citable']).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
    expect(byName['doc_date']).toMatchObject({ is_nullable: 'YES' });
    expect(byName['content_hash']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['embedding']).toMatchObject({ is_nullable: 'YES' });
  });

  it('has a foreign key from doc_chunks.pattern_id to concepts.concept_id', async () => {
    const fks = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'doc_chunks'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'pattern_id'
    `;
    expect(fks.length).toBeGreaterThan(0);
  });

  it('has a self-referencing foreign key from doc_chunks.parent_chunk_id to doc_chunks.chunk_id', async () => {
    const fks = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'doc_chunks'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'parent_chunk_id'
    `;
    expect(fks.length).toBeGreaterThan(0);
  });

  it('creates the concept_terms table with a term primary key and a concept_id foreign key', async () => {
    const columns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'concept_terms'
      ORDER BY ordinal_position
    `;
    const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));
    expect(byName['term']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['display_term']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['concept_id']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName['term_type']).toMatchObject({ data_type: 'USER-DEFINED', is_nullable: 'NO' });

    const pk = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'concept_terms' AND tc.constraint_type = 'PRIMARY KEY'
    `;
    expect(pk.map((r) => r.column_name)).toEqual(['term']);
  });

  // This test used to assert that feature 006's migration left jd_submissions and
  // candidate_training_directions untouched, which was true of that migration and is
  // deliberately no longer true of the database: feature 007 drops the directions table
  // and the six JdSubmission columns that only served the removed pipeline. The
  // assertion is rewritten rather than deleted, because what it was really protecting --
  // that a corpus migration does not silently reshape the submission tables -- is still
  // worth stating, now against the shape those tables are supposed to have.
  it('leaves jd_submissions with only the columns that survived the pipeline removal', async () => {
    const jdColumns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'jd_submissions'
    `;

    expect(jdColumns.map((c) => c.column_name).sort()).toEqual(['created_at', 'id', 'raw_text']);
  });

  it('has no candidate_training_directions table and no status column to gate on', async () => {
    // FR-020 and FR-022: the sufficiency gate needs somewhere to record its verdict, and
    // there is nowhere left.
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'candidate_training_directions'
    `;
    const statusColumns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'jd_submissions' AND column_name IN ('status', 'rejection_reason')
    `;

    expect(tables).toEqual([]);
    expect(statusColumns).toEqual([]);
  });
});
