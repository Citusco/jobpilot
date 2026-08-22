/**
 * Types for `graph-view-model.js`.
 *
 * Hand-written because the module ships to the browser as plain JavaScript -- there is no
 * build step to generate declarations from, and adding one to type three functions would
 * cost more than it returns.
 */

export type EdgeKind = 'authored' | 'inferred';
export type ResolutionTier = 'exact' | 'containment' | 'similarity' | 'unresolved';

/**
 * Which of the three classes a node belongs to. The distinction is the product, not
 * decoration: the first two are the posting, the third is what the role implies.
 */
export type NodeLayer = 'named-resolved' | 'named-unanswered' | 'adjacent';

export interface GraphNodePayload {
  id: string;
  conceptId: string | null;
  name: string;
  layer: NodeLayer;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
  evidence: string[];
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
  namedResolved: number;
  namedUnanswered: number;
  adjacent: number;
  /** Concepts the corpus holds that this posting's map does not draw. */
  offMap: number;
  corpusConcepts: number;
}

export interface ThresholdRecord {
  value: number;
  baseline: string;
  calibratedAt: string;
}

export interface GraphItem {
  surface: string;
  conceptId: string | null;
  tier: ResolutionTier;
  evidence: string[];
}

export interface ConceptGraph {
  submissionId: string;
  threshold: ThresholdRecord | null;
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
  items: GraphItem[];
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
  containment: number;
  similarity: number;
  unresolved: number;
}

export interface SubmissionResult {
  submissionId: string;
  items: SubmittedItem[];
  summary: SubmissionSummary;
}

export interface ViewNode {
  id: string;
  conceptId: string | null;
  name: string;
  layer: NodeLayer;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
  evidence: string[];
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
  id: string;
  name: string;
  layer: NodeLayer;
  kind: EdgeKind;
  strength: number;
}

export interface GraphViewModel {
  submissionId: string;
  nodes: ViewNode[];
  authoredEdges: GraphEdgePayload[];
  inferredEdges: GraphEdgePayload[];
  adjacency: Map<string, AdjacencyEntry[]>;
  resolved: ViewNode[];
  /** Named by the posting, answered by nothing: concepts first, then bare phrases. */
  unanswered: ViewNode[];
  adjacent: ViewNode[];
  /** No nodes at all -- a posting with nothing recognisable in it. */
  emptyMap: boolean;
  /** Nothing the posting named has material behind it. */
  nothingAnswered: boolean;
  summary: SubmissionSummary | null;
  stats: GraphStats;
  thresholdLabel: string;
}

export function buildViewModel(
  graph: ConceptGraph,
  submission: SubmissionResult | null,
): GraphViewModel;

export function describeThreshold(threshold: ThresholdRecord | null | undefined): string;

export function neighboursOf(viewModel: GraphViewModel, nodeId: string): Neighbour[];
