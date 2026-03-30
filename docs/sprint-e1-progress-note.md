# Sprint E1 Progress Note

_Current execution state: 2026-03-30 UTC._

## Review outcome so far

The DCA strategy review has identified two serious first-pass candidates:

- **Candidate A - Impulse-Aware Confirmation DCA**
- **Candidate B - Risk-Capped Pullback / Reclaim DCA**

### Current preference

- Candidate A is the preferred first implementation because it is safer and simpler.
- Candidate B is strategically interesting and should be preserved for later optimization, especially because fixing the stop to the original invalidation price makes the pullback/reclaim model much more defensible.

## Important design insight captured

The strongest refinement from review is:

- if DCA is used below the initial entry, the stop should remain anchored to the original invalidation price rather than drifting lower with each add

This prevents the strategy from becoming uncontrolled averaging down and preserves a clearer risk structure.

## Next likely step

Turn the selected first-pass candidate into a more formal strategy specification for later E2 modeling.
