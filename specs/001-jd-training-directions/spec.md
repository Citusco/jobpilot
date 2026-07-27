# Feature Specification: JD Structured Extraction and Candidate Training Direction Recommendation

**Feature Branch**: `001-jd-training-directions`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "Implement JD structured extraction: given a Job Description text, extract role/tech-stack/seniority information, and based on that recommend 3-6 candidate training directions, each with a rationale (traceable back to the JD text), tags, and a suggested question count. This step does not generate tasks yet — it stops at 'candidate direction recommendation'."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Extract JD structural information and generate candidate training directions (Priority: P1)

As a user responsible for designing live-coding training content for a given position, I
paste in a real Job Description text, and the system parses out structured information
such as role, tech stack, and seniority, and based on that information gives 3-6
candidate training directions; each direction states its recommendation rationale
(traceable back to the JD text), carries tags, and gives a suggested question count, so
that I can pick a direction based on this and decide whether to move on to question
generation next.

**Why this priority**: This is the very first link in the entire training-content
generation pipeline — without reliable structured extraction and direction
recommendation, none of the downstream steps (question generation, paper assembly) can
begin; this is the only user story in the current scope, and it is the entire content of
the MVP.

**Independent Test**: Can be independently verified by pasting in a real JD text,
checking whether the returned role/tech-stack/seniority summary is consistent with the
JD content, and whether the generated 3-6 directions each include a "traceable rationale
+ tags + suggested question count" — entirely without depending on the later
question-generation feature.

**Acceptance Scenarios**:

1. **Given** a JD text containing a clear role, a tech-stack list, and a seniority
   description, **When** it is submitted for parsing, **Then** the system returns a
   structured role/tech-stack/seniority summary and generates 3-6 candidate training
   directions, each carrying a rationale traceable back to the JD text, at least one tag,
   and a suggested question count.
2. **Given** an already-generated list of candidate directions, **When** the rationale of
   any direction is examined, **Then** that rationale clearly maps back to a specific
   statement or keyword in the JD text (verifiable, not fabricated out of thin air).
3. **Given** a JD whose tech-stack information is very rich and could map to many
   directions, **When** it is submitted for parsing, **Then** the system returns at most
   6 directions and does not grow without bound.

---

### Edge Cases

- How should the system respond when the JD text is too short, or is clearly not a job
  description (e.g., irrelevant text, garbled text)?
- How should the system label seniority when the JD does not mention an explicit
  seniority level?
- How should role extraction be handled when the same JD contains multiple different
  role descriptions (e.g., "full-stack or frontend both acceptable")?
- Is there a truncation or handling strategy when the JD text is extremely long (far
  beyond a normal job description's length)?
- How should the minimum-count requirement be handled when the tech stack mentioned in
  the JD is too broad or too sparse to support 3 meaningful directions?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a free-form JD text as input.
- **FR-002**: The system MUST extract role information from the JD text (e.g., "Backend
  Engineer", "Full-Stack Engineer", etc.).
- **FR-003**: The system MUST extract a tech-stack/skills list from the JD text
  (programming languages, frameworks, tools, etc.).
- **FR-004**: The system MUST extract or infer seniority information from the JD text
  (e.g., Junior/Mid-level/Senior/Staff).
- **FR-005**: The system MUST generate 3 to 6 candidate training directions based on the
  extracted role/tech-stack/seniority information; the count MUST NOT exceed this range.
- **FR-006**: Each candidate training direction MUST include a recommendation rationale,
  and that rationale MUST be traceable to specific content in the JD text (quoting the
  original text or explicitly pointing to the corresponding location).
- **FR-007**: Each candidate training direction MUST include at least one descriptive
  tag.
- **FR-008**: Each candidate training direction MUST include a suggested question count
  (a numeric value).
- **FR-009**: The system MUST NOT generate concrete training questions/task content
  within the scope of this feature — the output stops at the "candidate direction
  recommendation list"; task/question generation belongs to a separate, later feature.
- **FR-010**: When the JD text has no explicit seniority information, the system MUST
  provide an inferred seniority level, and MUST clearly mark that level as "inferred"
  rather than explicitly stated in the original JD text.
- **FR-011**: When the JD text content is insufficient to identify any role or tech-stack
  information, the system MUST reject the input and prompt the user to provide more
  complete JD content, without generating candidate directions.
- **FR-012**: When the extracted information is sufficient to identify role/tech-stack
  but insufficient to support 3 meaningful candidate directions, the system MUST still
  return fewer than 3 directions (rather than rejecting with an error, or padding the
  count up to 3 artificially), letting the returned direction count truthfully reflect
  how rich the information is.
- **FR-013**: The candidate training direction recommendation result MUST be persisted
  and associated with the JD submission record that produced it, so that the later
  question-generation stage can reference the same candidate-direction data without
  requiring the user to resubmit the JD text.

### Key Entities *(include if feature involves data)*

- **JD Submission**: Represents a single submission of JD text, containing the raw JD
  text, the extracted role/tech-stack/seniority summary, and the submission timestamp.
- **Candidate Training Direction**: Represents one training direction recommended for a
  given JD submission, containing the direction name, recommendation rationale
  (including a quote from the JD text), a list of tags, and a suggested question count;
  associated with the JD submission it belongs to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a JD that contains clear role, tech-stack, and seniority information,
  the system returns a structured summary and 3-6 candidate directions within a single
  submission, and the user can proceed to the next decision step without manually
  correcting the extraction result.
- **SC-002**: When manually spot-checking candidate-direction rationales, the proportion
  confirmed to "genuinely come from the JD text" reaches 100% — there are no rationales
  that are disconnected from the original text or fabricated out of thin air.
- **SC-003**: 90% or more of the candidate-direction tags and suggested question counts
  are, in the user's judgment, reasonable and directly adoptable without major
  adjustment.
- **SC-004**: The user can go from pasting the JD text to seeing a usable list of
  candidate training directions, completing one round of evaluation and decision-making
  within a few minutes, with no need for additional manual organization or conversion of
  JD information.

## Assumptions

- The user (an internal training-content designer / recruiter) will provide a real,
  reasonably complete job description text, rather than a short input containing only a
  job title.
- Seniority classification uses industry-common, coarse-grained tiers (e.g.,
  Junior/Mid-level/Senior/Staff), and does not need to map to any specific company's more
  granular internal leveling system.
- The scope of recommended candidate training directions is limited to
  technical-capability-related directions (e.g., a specific tech stack, system design,
  algorithms, etc.), and does not cover non-technical directions (e.g., communication,
  culture fit).
- The JD text may be in Chinese, English, or a mix of both; the system needs to be able
  to handle common job descriptions in these two languages, and is not required to
  support other languages.
- When information is insufficient to identify role/tech-stack, the approach is to
  "reject the input and prompt for resubmission" rather than "return a low-confidence
  guess" (FR-011) — because guessed structured information contaminates every downstream
  step.
- When there is not enough information to support 3 meaningful directions, the approach
  is to "truthfully return fewer than 3 directions" rather than "reject with an error" or
  "pad the count up to 3" (FR-012) — to avoid producing low-quality, forced directions
  just to hit a count.
- The candidate training direction recommendation result uses "persist and associate
  with the JD submission record" rather than "a one-off response to a single request"
  (FR-013) — because the product is positioned as a multi-stage pipeline (JD extraction →
  direction recommendation → future question generation), and the next stage needs to
  reference the same candidate-direction data. The above three points are all reasonable
  default judgment calls made based on context; if they don't match actual intent, they
  can be adjusted via `/speckit-clarify`.
