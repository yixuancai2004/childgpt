# Two actual frontend demos

Run on 2026-10-18 through the local browser UI with Groq `qwen/qwen3.8-27b`.

- `conversation.json`: 3 model-generated replies; greeting, the reported cooking offer, and imaginary café naming.
- `learning.json`: 5 model-generated replies; unknown concept, teaching, presenter-controlled omission, explicit correction and ordinary sampled recall.
- `conversation.jpg`, `learning.jpg`: screenshots of the final frontend replay pages.
- `validation.json`: the checks actually performed, with scope and limitations.

The JSON files were exported using the frontend's download button. They contain synthetic example conversations, state, memory snapshots and reply provenance, not session tokens. Replays are labelled as recorded output and freeze mastery at recording time. Live demos create independent sessions and do not overwrite the original learner. The build ships the two JSON recordings to the static site and embeds them in the standalone HTML.

Local replay links: `http://localhost:8000/?demo=conversation#studio` and `http://localhost:8000/?demo=learning#studio`. Click the respective live-demo button to issue fresh provider requests. Outputs can differ, and a rate-limited or failed run is not labelled complete.
