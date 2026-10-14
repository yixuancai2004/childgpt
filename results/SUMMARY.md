# ChildGPT — executed evaluation

Run time: 2026-10-14T12:03:25.519Z
Runtime: v24.15.0

## Scope
Executed deterministic controller tests and synthetic simulations. No live model calls; no recruited participants; no clinical or wellbeing claims.

## Functional controller tests
96/96 scripted checks passed.

- Knowledge boundary: 20/20
- Taught recall: 20/20
- Correction update: 10/10
- Memory isolation: 10/10
- Controlled recall: 10/10
- Policy consistency: 10/10
- Error calibration: 3/3
- Corruption operators: 10/10
- Clarification & curiosity: 3/3

## One synthetic example (seed 42)
Calibration: days 1–20. Injected change: day 31.
First signal: 38. Detection delay: 7 days.
Pre-change false alarm: false.

## Repeated simulations
200 stable, 200 sustained-change and 200 temporary-dip sequences, 60 days each. Detector: one-sided CUSUM on five content-free indicators. Seed 1000.
Fixed k=0.5, h=5, shift=1.2. Baseline days=20. No test-set tuning.

- Stable-sequence false alarms: 40/200 (20.0%).
- Post-change first detections: 195/200 (97.5%).
- Pre-change alarms in changed sequences: 5/200.
- Changed sequences with no signal: 0/200.
- Mean detection delay among post-change first detections: 4.13 days.
- Median detection delay among post-change first detections: 3 days.

- Alarms after a separate 3-day temporary dip: 90/200 (45.0%).

Fraction of stable 60-day sequences with at least one alarm after the first 20 calibration days (or selected baselineDays). Not a per-day false-positive rate.
First alarm day minus change day (day 31); only post-change first detections. Pre-change alarms and misses reported separately.
Separate 3-day temporary dips (days 31–33), then a return to baseline. Counts sequences whose first alarm came on or after day 31. A sustained-change detector is expected to flag some of these; this is a limitation, not a success.

## Threshold sweep (sensitivity analysis, k=0.5)
The default h=5 was fixed before these runs. The table shows the trade-off; choosing h from it on the same seeds would be test-set tuning.

| h | Stable false alarms | Detected after change | 3-day-dip alarms | Mean delay (days) |
|---|---|---|---|---|
| 3 | 44.5% | 86.5% | 62.0% | 2.41 |
| 4 | 31.0% | 95.5% | 56.5% | 3.29 |
| 5 | 20.0% | 97.5% | 45.0% | 4.13 |
| 6 | 12.0% | 98.5% | 33.0% | 4.98 |
| 8 | 9.0% | 98.5% | 19.0% | 6.7 |
| 10 | 4.5% | 98.5% | 11.0% | 8.19 |

## What cannot be concluded
Passing scripted tests is not proof of open-ended language understanding or a universal absence of knowledge leakage. These are not live-provider evaluations. Synthetic behaviour cannot establish engagement, loneliness reduction, disease detection, or safety in older adults. The finite-data baseline and arbitrary generator can produce material false alarms; report them rather than selecting only an attractive trace.

Reproduce: `npm run evaluate`.
