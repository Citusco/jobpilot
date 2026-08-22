/**
 * Types for `graph-view-model.js`.
 *
 * Hand-written because the module ships to the browser as plain JavaScript -- there is no
 * build step to generate declarations from, and adding one to type four functions would
 * cost more than it returns.
 */

export type EdgeKind = 'authored' | 'inferred';
export type ResolutionTier = 'exact' | 'similarity' | 'unresolved';

export interface GraphNodePayload {
  conceptId: string;
  name: string;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
}

export interface GraphEdgePayload {
  a: string;
  b: string;
  kind: EdgeKind;
  strength: number;
}

export interface GraphStats {
  nodes: number;
  authoredEdges: number;
  inferredEdges: number;
  meanDegree: number;
  inferredCut: number | null;
}

export interface ThresholdRecord {
  value: number;
  baseline: string;
  calibratedAt: string;
}

export interface ConceptGraph {
  submissionId: string;
  threshold: ThresholdRecord | null;
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
  stats: GraphStats;
}

export interface SubmittedItem {
  surface: string;
  conceptId: string | null;
  tier: ResolutionTier;
  score: number | null;
  evidence: string[];
}

export interface SubmissionSummary {
  total: number;
  exact: number;
  similarity: number;
  unresolved: number;
}

export interface SubmissionResult {
  submissionId: string;
  items: SubmittedItem[];
  summary: SubmissionSummary;
}

export interface UnresolvedItem {
  surface: string;
  score: number | null;
  evidence: string[];
}

export interface ViewNode {
  conceptId: string;
  name: string;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
  authoredDegree: number;
  inferredDegree: number;
  degree: number;
}

export interface AdjacencyEntry {
  other: string;
  kind: EdgeKind;
  strength: number;
}

export interface Neighbour {
  conceptId: string;
  name: string;
  kind: EdgeKind;
  strength: number;
}

export interface GraphViewModel {
  submissionId: string;
  nodes: ViewNode[];
  authoredEdges: GraphEdgePayload[];
  inferredEdges: GraphEdgePayload[];
  adjacency: Map<string, AdjacencyEntry[]>;
  matchedCount: number;
  /** Every concept at relevance 0 -- the common case for a real posting. */
  allUnmatched: boolean;
  withoutCorpusCount: number;
  unresolved: UnresolvedItem[];
  /** False when the graph was loaded by id, with no submission response to read. */
  unresolvedAvailable: boolean;
  summary: SubmissionSummary | null;
  stats: GraphStats;
  thresholdLabel: string;
}

export function buildViewModel(
  graph: ConceptGraph,
  submission: SubmissionResult | null,
): GraphViewModel;

export function collectUnresolved(submission: SubmissionResult | null): UnresolvedItem[];

export function describeThreshold(threshold: ThresholdRecord | null | undefined): string;

export function neighboursOf(viewModel: GraphViewModel, conceptId: string): Neighbour[];
