# Implementation mapped to the submitted proposal

## Assignment boundaries

This repository implements presentation requirement **3 — explanation of approach and algorithms** and **4 — results, simulated results or expected outcomes and their connection to the problem**. It does not create slides. The course guide permits pseudocode, simulated results and incomplete full-scale implementation; this deliverable goes further by executing an inspectable software prototype.

## Requirement-to-code matrix

| Proposal component | Implemented evidence | Scope / deliberate simplification |
|---|---|---|
| Child Context and Memory | `Engine`, per-profile memories, topic, content, mastery, source interaction, revisions, related concepts, quoted mentions | JSON-backed controller; no vector database or training |
| Topic/keyword graph | Edges between same-domain concepts that share a keyword or mention each other; quoted mentions feed a curiosity queue asked on exploration turns; high-mastery autonomous follow-ups at the connecting stage ask how a concept connects to a related one | Keyword overlap, not semantic similarity; curiosity only from terms the teacher marked with quotes |
| Knowledge Boundary and Retrieval | Exact normalized concept retrieval; unknown item selects ask-to-learn | Exact concept matching, not semantic retrieval; aliases not automatically resolved |
| Dialogue Policy | Unresolved conflicts first (clarify); otherwise exploration every fifth selection turn; otherwise rank by 0.5(1−mastery)+0.3 staleness+0.2 topic relevance | Fixed, visible weights; not learned or optimized |
| Controlled Recall | Policy-selected recalls follow a mastery-dependent plan (low: ask; medium: 40% correct / 30% uncertain / 30% error; high: 90% / 5% / 5%) with four operators: omit_step, swap_steps, confuse_related, approximate. The draw is a hash of profile, memory and turn, so every decision replays. A presenter-triggered omission remains for the scripted demo. Stored memory is never changed | Operators only drop or rearrange taught content; safety-sensitive memories are never corrupted; no realistic cognitive-ageing model |
| Growth and retention | Time-decayed current mastery, reinforcement-dependent half-life, and discovering / practising / connecting stages based on learned breadth and accepted lessons; see `tests/learning.test.mjs` | Illustrative engineering rules, not a validated developmental model; stored facts are preserved |
| LLM interface | Contextual intent classification + exact-span extraction + action-conditioned generated speech. The extractor receives the current target, six recent messages and at most eight relevant memories from the active profile | A concept may refer to the dialogue target or a permitted memory; new factual content must come from the latest message. Generated text is prompt-constrained; semantic factual entailment is not proven by the output validator |
| Knowledge Update | Natural-language teaching, correction and confirmation; uncertainty remains pending. Unknown tentative meanings cannot be recalled until confirmed; conflicting known versions require an explicit explanation | Local rules cover common English/Chinese phrases. A vague yes cannot choose a conflicting version or endorse a corrupted recall. Structured controls remain available for debugging |
| Scheduler | Optional invitations, cooldown, one outstanding invitation, skip without punishment | Works only while browser page is open; no email/push/background service |
| Metadata logger | Content-free response timing, character length, correction and initiation records | Character count rather than language-specific word tokenization; descriptive metadata only |
| Evaluation harness | 96 scripted checks (incl. error-rate calibration and operator checks), CLI and in-browser; additional HTTP/API tests | Finite deterministic tests, not a broad adversarial live-model benchmark |
| Behavioural evaluation | Seeded daily traces + personalized baseline + five-indicator CUSUM + 600-run counts (stable, sustained, 3-day dip) + threshold sweep | Synthetic data only; weights and distributions are illustrative |
| End-to-end demonstration | Guided scenario, trace inspection and exported results | No recruited participants or validated psychosocial outcomes |

## Learning-loop execution

1. Accept ordinary chat by default. When explicitly connected to a configured provider, classify each chat message using the active profile's dialogue context. The candidate may reference the current target or a permitted memory ID without repeating the concept. Validate every new content span against the latest user message. Without a provider, or after rejection/failure, use conservative contextual English/Chinese rules. Structured actions remain optional debug controls.
2. Validate the action. For teaching/correction, apply a deterministic memory transaction; keep a source interaction and correction history. Conflicting non-correction teaching does not replace a prior fact.
3. Retrieve only this profile's permitted memory. Question selection chooses a ranked target; direct questions, manual recall and autonomous review all use the same action selector based on time-decayed current mastery. Unknown facts select ask-to-learn; the realizer is instructed not to answer them from pretrained knowledge.
4. Realize the selected action. The key-free path uses fixed templates. A configured provider generates the full reply from a server-built action contract. Only permitted facts and pending candidates are sent, with no original history or omitted text for controlled recall. The latter preserves the selected fragment and order exactly; other actions allow paraphrase. Validation checks shape, action, length, required questions and literal omission repair, but does not prove semantic grounding. Invalid API output falls back visibly. Generated replies only update conversation history, never memory or mastery.
5. Append conversation and content-free metadata. In server mode, persist the complete session after realization. On the next interaction, the updated memory is retrieved.

The architecture deliberately distinguishes **system-defined mastery** from model confidence. New fact: 0.35; current mastery = stored strength × 2^(−elapsed days / stability days), using whole elapsed hours. The initial half-life is 3 days. Repetition adds 0.10, confirmation 0.15, correction 0.20 to the decayed value, bounded to [0.35, 1] after reinforcement. Each reinforcement resets its time anchor and extends the half-life ×1.5, capped at 90 days. Merely asking or generating a reply never strengthens memory. A low-mastery previously learned fact requests a reminder, with no original fact or latest message exposed to the speech model. Storage retains the original and its provenance.

Stages are per-profile progress milestones: discovering initially; practising after at least 3 concepts, 2 reinforced concepts and 6 accepted lessons; connecting after at least 6 concepts, 4 reinforced concepts and 18 accepted lessons. All thresholds are conjunctive. Stages do not regress with time. Only confirmed teaching, explicit corrections and valid confirmations count. Autonomous correct high-mastery recalls ask for usage/examples at practising, and may ask about related concepts at connecting. Direct questions remain answers rather than automatic follow-up quizzes. The realizer receives the stage style but no additional knowledge. These parameters are engineering choices, not validated child learning rates or human ages.

The v1.2 constructor migrates v1.0/v1.1 snapshots without replacing facts or history. Legacy reinforcement dates use the latest recorded correction, otherwise `learnedAt`; lesson counts use the initial fact plus available correction history. Missing historical confirmations cannot be reconstructed. No browser interval or background task is needed for decay: it is derived at retrieval and UI rendering. The existing seven-day backend session lifetime is unchanged.

An uncertain new explanation is stored with empty confirmed content, zero mastery, and a pending candidate plus source interaction. Queries and policy selection ask for clarification instead of treating that candidate as knowledge. Once explicitly confirmed it starts at mastery 0.35 and retains the candidate's source. For an existing memory, tentative or conflicting information leaves the confirmed content unchanged. Bare agreement cannot decide between two versions; the structured debug Confirm control retains its explicit keep-first meaning.

Dialogue targets are stored per profile and survive JSON restoration. The model never receives another profile's dialogue or memories. New facts cannot be copied from conversation history into an update: they must appear in the latest reply. Exact-span validation limits invented facts but does not prove correct intent classification. Partial edits to recipes and stories that do not replace a definition require further clarification in this version.

On 2026-10-18, live Groq `qwen/qwen3.8-27b` calls first passed a synthetic connection check and Chinese teaching/correction/recall with approved templates. After the output upgrade, live checks exercised generated Chinese greetings, teaching, contextual recall, controlled omission and unknown-word inquiry. Testing exposed occasional pronoun/unknown-question misclassification and malformed speech objects; targeted prompt revisions and Groq strict response schemas addressed the observed cases. The omission reply retained the visible fragment without restoring the hidden step, and stored memory remained intact. Only synthetic content was sent and temporary sessions were deleted. These are small functional checks, not a language-quality or adversarial grounding benchmark.

The v1.2 change passed 186 Node tests, including fixed-clock decay, reinforcement, all recall entry points, stage thresholds, profile isolation, legacy migration and HTTP persistence. A live Groq check used a temporary session and an injected server learning clock: Chinese teaching, a three-day-later question with no facts supplied to the realizer, and a reminder all generated validated replies; the stored original was preserved and the half-life increased from 3 to 4.5 days. The temporary session was removed. Headless Chrome checked stage progress, decayed scores, reinforcement, reload restoration and mobile layout with synthetic local data. This verifies the tested software paths, not a real three-day longitudinal study.

## Conversational voice (v1.2.1)

The old generic `help` template exposed command examples and treated social conversation as a missing lesson. It now supports brief language-matched social fallback responses, and the provider prompt treats greetings, storytelling, feelings, identity questions, play and tone feedback as conversation without a memory write. Social topic changes clear the confirmation target so an unrelated “yes” cannot strengthen the previous lesson. Internal `help` action names remain compatible with old traces.

The realizer has an explicit curious, playful child-character voice. Teaching and correction no longer require a confirmation question; acknowledgments can stand alone, and confirmations should not trigger another full recitation. For social replies, at most three preceding social exchanges are supplied, each message limited to 600 characters; the provisional fallback and lesson exchanges are excluded. This context is for conversation continuity, not evidence for factual learning. Controlled and forgotten recalls receive no social context. Pretend play is fictional and does not become learned knowledge. The character remains honest about being AI when asked, without repeatedly inserting identity disclaimers.

The change passed 197 Node tests, including social intent routing, brief Chinese fallbacks after provider failure, optional confirmation questions, story continuity, legacy-template filtering and isolation of recall context. Live Groq checks exercised six synthetic turns: greeting, a two-turn dog-and-leaf story, a request to stop questions, pretend play and a new definition. The first story response added an unsupported assumption about a leaf’s weight; the prompt was tightened to avoid unreported details and repeated questions. Later checks respected the no-question request and clearly marked the adventure as imaginary. This is a small qualitative check, not a proof that every reply will be natural or grounded.

The UI no longer advertises a teaching syntax as the conversation starter. Action labels appear only with the debug controls open. Provider availability and fallback status remain visible outside the character's speech. Free-form social reactions can still make unsupported inferences; prompt constraints and finite examples do not prove semantic grounding.

## CUSUM implementation details

Daily synthetic variables: response rate (binomial observations), conditional response delay, conditional explanation length, self-started interactions and correction count. All five enter the composite detector.

The first 20 days establish the person's baseline. Each component is standardized against that fixed baseline. Response rate, explanation length, self-started interactions and corrections have negative signs (fewer is adverse); log response delay has a positive sign. Weights are 0.30 (rate), 0.25 (log delay), 0.20 (length), 0.15 (self-started) and 0.10 (corrections), fixed before evaluation. Missing conditional observations are omitted and the remaining weights are renormalized. Standard-deviation floors avoid division by very small estimates. The composite is standardized again using only the calibration window.

```
z_t = standardized adverse-direction composite
S_0 = 0
S_t = max(0, S_(t-1) + z_t - k)
first signal when S_t > h
```

The CUSUM is a one-sided upper detector because all components have first been put into the same change direction. There is no lower-tail signal in this implementation. Baseline observations do not contribute to the monitored CUSUM. The first alarm is latched; there is no automatic reset or post-alarm baseline adaptation. These decisions matter for interpretation of rates.

Defaults: k=0.5, h=5, 60-day traces, day-31 change, baseline days 1–20, illustrative latent shift=1.2. The core recurrence follows the tabular form documented by [NIST](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm); the synthetic distributions, weights and feature engineering are original prototype choices.

## Evaluation interpretation

- Functional pass counts are measured against predetermined outputs of the implemented controller, not an assessment of fluent conversation or model quality.
- Stable-sequence false alarm fraction counts sequences with at least one alarm during days 21–60. It is not a per-observation false-positive rate or a clinical specificity estimate.
- Changed-sequence outcomes are partitioned into pre-change first alarms, post-change first detections, and no alarm. These categories sum to the number of runs.
- Detection delay is first alarm day minus the injected change day, conditional on the first alarm being after the change. Report the excluded pre-change cases and misses alongside it.
- The temporary-dip scenario (days 31–33 only) measures how often a short dip is flagged. At h=5 this is 45%: the detector cannot tell a brief dip from a sustained change, which argues for a persistence rule or human follow-up before any alert.
- The threshold sweep (h = 3…10) shows the false-alarm / delay trade-off. It is a sensitivity analysis, not a tuning step.
- Defaults were held fixed for these runs. Do not silently tune h on these evaluation seeds and then quote the same results as independent validation.
- Test a wider family of generators and calibrate thresholds on separate data before drawing robust statistical conclusions. Human benefit requires a different, ethically designed study.

## Privacy and public deployment

Only synthetic fixtures and generated evaluation evidence belong in the public repository. Do not commit `.env`, `data/`, provider tokens, session tokens or exports containing real conversation content. The build is an explicit static allowlist and does not copy the backend or its secrets into `dist`.

A browser-only learner A/B split is a logical demonstration, not authentication. The backend provides distinct random bearer sessions and separate server-side storage. Session bearer tokens are hashed for filenames; provider secrets are not included in API responses. Shared access tokens, bounded limits and CORS do not replace a full production identity, security, consent and retention design.


## Frontend connection and reproducible demos (v1.2.2)

The local CLI now bootstraps the server's own loopback page when an LLM is configured. A random runtime capability is injected only into uncached HTML served over a loopback-bound socket to a loopback client with a literal localhost Host. The bootstrap POST additionally requires the matching capability, exact Origin and `Sec-Fetch-Site: same-origin`. Wildcard listeners, remote pages and static builds receive no capability; ordinary app-token/bearer authentication remains in place. Set `LOCAL_AUTO_CONNECT=false` to opt out. Existing tab sessions restore before bootstrap, and transient restore failures do not silently create a blank replacement learner.

Each assistant message persists its own generation source, model and sanitized error category. Configured model status no longer implies every response used that model. `/api/reply/retry` serializes with turns, accepts only the current interaction, and reapplies only speech realization; already-generated replies are idempotent. It cannot reinforce a memory or append a new interaction. Provider bodies and credentials never enter diagnostics.

Two frontend buttons create independent authenticated demo sessions. The conversation scenario uses three natural social turns, including the reported cooking invitation. The learning scenario uses natural-language questions, teaching and correction, plus one explicitly labelled presenter-controlled omission. At 55% mastery the final recall is sampled under the ordinary policy rather than forced correct. A rate-limited realization waits the bounded retry interval and retries speech at most twice without replaying teaching. Exports contain synthetic state, per-step traces, provider provenance and timestamps, never bearer tokens. Completed exports are shipped as clearly labelled recorded replays, including in the standalone HTML. No public deployment was performed by this change.

The two live demos were run through the actual browser UI and exported using its download button on 2026-10-18: 3/3 and 5/5 LLM-generated responses. Their recordings are in `results/demos/`. This validates those paths, not arbitrary conversational fidelity. Unit tests use mocks and do not count as live model evidence.
