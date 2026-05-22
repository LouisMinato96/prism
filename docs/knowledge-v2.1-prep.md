# Prism Knowledge V2.1 Prep (Question Classifier)

This file is the active checklist for V2.1 planning and implementation.

## V2.1 Goal

Add a deterministic question classifier that selects answer shape before evidence rendering.

For questions like "How does auth work?", route to an architecture-style answer with:

1. system storyline
2. entry files
3. building blocks
4. dependency flow
5. proof references and explicit gaps

## Scope Freeze (V2.1)

### In Scope

1. Deterministic `questionClass` routing rules.
2. Per-question classification artifact (`classification.json`).
3. Deterministic confidence bands and tie-break policy.
4. Topic candidate ranking metadata (lightweight, no deep evidence extraction changes yet).

### Out of Scope

1. Full evidence-pack extraction changes (V2.2).
2. Human-first answer renderer redesign (V2.3).
3. Strict confidence gate upgrades (V2.4).
4. Batch UX expansions (V2.5).

## Deterministic Classes

1. `architecture_storyline`
2. `entrypoint_trace`
3. `dependency_flow`
4. `building_blocks`
5. `reference_lookup`
6. `change_guidance`
7. `unknown_or_ambiguous`

## Rule Contract (To Lock Before Coding)

For each class define:

1. trigger phrases
2. token/anchor signals (path, symbol, route, config key)
3. score weights
4. tie-break order
5. minimum threshold

No class decision should depend on probabilistic LLM judgment.

## Output Contract (V2.1)

Per question write `classification.json` with:

1. normalized question
2. matched rules
3. selected class and score
4. confidence band
5. top topic candidates (and why they matched)

## Confidence Bands (V2.1)

1. `high`: clear class winner, no meaningful tie
2. `medium`: clear winner with minor tie pressure
3. `low`: ambiguous class/topic
4. `none`: no reliable match

## Deterministic Rule Table (Locked)

Classifier scoring model:

1. `classScore = sum(matchedRuleWeights)` per class.
2. Rules are additive and deterministic.
3. Matching is exact token/phrase/pattern based (no model inference).

### Global Signals and Weights

| Signal | Match Rule | Weight |
| --- | --- | --- |
| `verb_how` | `how`, `how does`, `explain`, `overview` | +22 to `architecture_storyline` |
| `verb_where` | `where`, `located`, `defined` | +24 to `reference_lookup` |
| `verb_trace` | `start`, `entry`, `handle`, `route`, `trigger` | +22 to `entrypoint_trace` |
| `verb_dep` | `depends`, `calls`, `uses`, `impact` | +22 to `dependency_flow` |
| `verb_parts` | `parts`, `components`, `building blocks`, `made of` | +20 to `building_blocks` |
| `verb_change` | `add`, `modify`, `change`, `implement` | +22 to `change_guidance` |
| `path_anchor` | token looks like repo path (`/`, `.ts`, `.tsx`, `.js`, `.md`) | +18 to `reference_lookup`, +8 to `dependency_flow` |
| `symbol_anchor` | token looks like symbol (`camelCase`, `PascalCase`, `useX`, `Class.method`) | +16 to `reference_lookup`, +10 to `dependency_flow` |
| `route_anchor` | token includes `/api`, `route`, `endpoint`, `pages/` | +16 to `entrypoint_trace` |
| `domain_token` | known topic token from knowledge index (for example `auth`, `permission`) | +8 all classes except `unknown_or_ambiguous` |

### Class-Specific Phrase Rules

| Class | Phrase Patterns | Weight |
| --- | --- | --- |
| `architecture_storyline` | `how does * work`, `explain *`, `architecture of *` | +26 |
| `entrypoint_trace` | `where does * start`, `what handles *`, `entry point for *` | +26 |
| `dependency_flow` | `what depends on *`, `what calls *`, `what does * use` | +26 |
| `building_blocks` | `what files make up *`, `components of *`, `building blocks of *` | +24 |
| `reference_lookup` | `where is * defined`, `find usages of *`, `references of *` | +28 |
| `change_guidance` | `how to add *`, `where should i modify *`, `how to implement *` | +26 |

### Penalties

| Condition | Penalty |
| --- | --- |
| Question length < 2 non-stopword tokens | -20 all non-unknown classes |
| No verb signal and no anchor signal | -18 all non-unknown classes |
| Conflicting top intents (difference <= 4 points) | top two classes both marked ambiguous |

## Selection, Thresholds, and Tie-Break

Selection:

1. Compute scores for all 6 primary classes.
2. Pick highest-scoring class as candidate.
3. Apply thresholds and ambiguity checks.

Thresholds:

1. `selected` requires `score >= 28`.
2. If top score `< 28`, class = `unknown_or_ambiguous`.
3. If `abs(top1 - top2) <= 4`, class = `unknown_or_ambiguous`.

Deterministic tie-break order (used only when top scores are exactly equal and not ambiguous by threshold):

1. `reference_lookup`
2. `entrypoint_trace`
3. `dependency_flow`
4. `architecture_storyline`
5. `building_blocks`
6. `change_guidance`

Reasoning:

1. Prefer concrete lookup and trace intents over broader narrative intents.
2. Keep change guidance conservative unless explicit modification verbs exist.

## Confidence Mapping (Exact)

Given final class score and margin `delta = top1 - top2`:

1. `high`: `score >= 52` and `delta >= 12`
2. `medium`: `score >= 40` and `delta >= 8`
3. `low`: `score >= 28` and `delta >= 5`
4. `none`: otherwise (`unknown_or_ambiguous`)

## V2.1 Examples (Expected Class)

| Question | Expected Class |
| --- | --- |
| `How does the auth system work?` | `architecture_storyline` |
| `Where is useAuth defined?` | `reference_lookup` |
| `What calls deleteOldToken?` | `dependency_flow` |
| `Where does login flow start?` | `entrypoint_trace` |
| `What files make up auth?` | `building_blocks` |
| `How should I add MFA?` | `change_guidance` |
| `auth?` | `unknown_or_ambiguous` |

## Test Plan (V2.1)

1. Golden tests for 10-15 representative questions.
2. Determinism test: same input -> byte-identical output.
3. Ambiguity tests for mixed-domain prompts.
4. CLI parse coverage for any new V2.1 flags/options.

## Implementation Checklist

- [x] Lock class rule table with weights and thresholds.
- [ ] Finalize `classification.json` schema.
- [ ] Add classifier/routing implementation.
- [ ] Add tests (golden + determinism + ambiguity).
- [ ] Run `format:check`, `typecheck`, `test`.
- [ ] Update docs after passing tests.
