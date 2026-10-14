# Implementation mapped to the submitted proposal

## Assignment boundaries

This repository implements presentation requirement **3 — explanation of approach and algorithms** and **4 — results, simulated results or expected outcomes and their connection to the problem**. It does not create slides. The course guide permits pseudocode, simulated results and incomplete full-scale implementation; this deliverable goes further by executing an inspectable software prototype.

## Requirement-to-code matrix

| Proposal component | Implemented evidence | Scope / deliberate simplification |
|---|---|---|
| Child Context and Memory | `Engine`, per-profile memories, topic, content, mastery, source interaction, revisions, related concepts, quoted mentions | JSON-backed controller; no vector database or training |
| Topic/keyword graph | Edges between same-domain concepts that share a keyword or mention each other; quoted mentions feed a curiosity queue asked on exploration turns; high-mastery follow-ups ask how a concept connects to a related one | Keyword overlap, not semantic similarity; curiosity only from terms the teacher marked with quotes |
| Knowledge Boundary and Retrieval | Exact normalized concept retrieval; unknown item selects ask-to-learn | Exact concept matching, not semantic retrieval; aliases not automatically resolved |
| Dialogue Policy | Unresolved conflicts first (clarify); otherwise exploration every fifth selection turn; otherwise rank by 0.5(1−mastery)+0.3 staleness+0.2 topic relevance | Fixed, visible weights; not learned or optimized |
| Controlled Recall | Policy-selected recalls follow a mastery-dependent plan (low: ask; medium: 40% correct / 30% uncertain / 30% error; high: 90% / 5% / 5%) with four operators: omit_step, swap_steps, confuse_related, approximate. The draw is a hash of profile, memory and turn, so every decision replays. A presenter-triggered omission remains for the scripted demo. Stored memory is never changed | Operators only drop or rearrange taught content; safety-sensitive memories are never corrupted; no realistic cognitive-ageing model |
| LLM interface | Server-side exact-span extraction + approved phrase selection | Bounded output, not unrestricted generated dialogue; cannot prove semantic extraction always correct |
| Knowledge Update | New teaching, repeated teaching, explicit correction, confirmation, pending conflict resolved by a later clarification question (Correct replaces, Confirm keeps the first) | Structured forms work without API |
| Scheduler | Optional invitations, cooldown, one outstanding invitation, skip without punishment | Works only while browser page is open; no email/push/background service |
| Metadata logger | Content-free response timing, character length, correction and initiation records | Character count rather than language-specific word tokenization; descriptive metadata only |
| Evaluation harness | 96 scripted checks (incl. error-rate calibration and operator checks), CLI and in-browser; additional HTTP/API tests | Finite deterministic tests, not a broad adversarial live-model benchmark |
| Behavioural evaluation | Seeded daily traces + personalized baseline + five-indicator CUSUM + 600-run counts (stable, sustained, 3-day dip) + threshold sweep | Synthetic data only; weights and distributions are illustrative |
| End-to-end demonstration | Guided scenario, trace inspection and exported results | No recruited participants or validated psychosocial outcomes |

## Learning-loop execution

1. Parse a structured input. When explicitly connected to a configured provider, an otherwise-unparsed free-text message may be converted into a candidate action containing exact spans from that message.
2. Validate the action. For teaching/correction, apply a deterministic memory transaction; keep a source interaction and correction history. Conflicting non-correction teaching does not replace a prior fact.
3. Retrieve only this profile's permitted memory. Question selection chooses a ranked target and a mastery-dependent action. Unknown facts cause ask-to-learn, never a pretrained answer.
4. Realize the selected action. The key-free path uses fixed templates. A configured provider can choose one approved wrapper, but it cannot change the fact slot. Invalid API output falls back visibly.
5. Append conversation and content-free metadata. In server mode, persist the complete session after realization. On the next interaction, the updated memory is retrieved.

The architecture deliberately distinguishes **system-defined mastery** from model confidence. New fact: 0.35; repetition: +0.10; confirmation: +0.15; explicit correction: +0.20, capped at 1. Recall itself never increases mastery. These increments are didactic choices, not validated learning rates.

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
