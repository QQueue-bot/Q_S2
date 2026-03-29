# Milestone D - MDX Settings Mapping Roadmap

_Last updated: 2026-03-29 UTC._

## Purpose

Milestone D makes S2 able to load the right MDX-aligned settings for the right bot, represent them durably inside S2, validate them safely, and integrate them into the runtime resolution path.

This milestone is about:

- MDX settings source definition
- MDX-to-S2 mapping
- per-bot MDX binding
- validation and safety
- runtime integration

This milestone is not the full DCA strategy milestone. If MDX contains DCA-related concepts, they should be mapped structurally here, but the real strategy design remains part of Milestone E.

---

## Milestone D objective

Build the settings-mapping layer that allows S2 to move from:

- bot-aware routing and credential resolution

to:

- bot-specific MDX-aligned settings resolution that is safe, auditable, and ready for limited live use.

---

## Planning principle for Milestone D

Milestone D should separate three concerns clearly:

1. **source definition**
- what MDX data looks like

2. **semantic mapping**
- how MDX concepts translate into S2 settings concepts

3. **runtime use**
- how mapped settings become part of the bot runtime path

Keeping those layers separate reduces confusion and makes safety validation easier.

---

## Sprint family

### Sprint D1 - MDX Settings Source Model
**Objective**
Define how MDX settings are represented as source data for S2.

**Work**
- define the MDX settings source format
- decide whether MDX data is imported as files, mapped JSON, or normalized S2-side config objects
- document the expected per-bot MDX input structure
- define what fields are in scope now versus later

**Output**
- MDX settings source model

**Validation**
- one example MDX settings source for Bot1 can be loaded structurally
- field definitions are explicit
- unsupported or missing fields are identified clearly

---

### Sprint D2 - MDX-to-S2 Mapping Schema
**Objective**
Define the translation layer between MDX settings and S2 settings concepts.

**Work**
- map MDX fields to S2 settings fields
- identify direct mappings versus derived mappings
- identify unsupported MDX fields
- define default behavior for missing MDX fields
- define hard-fail versus warning behavior

**Output**
- MDX to S2 mapping schema

**Validation**
- a Bot1 MDX sample can be translated into an S2-shaped config result
- unsupported fields are surfaced clearly
- ambiguous fields are documented

---

### Sprint D3 - MDX Mapping Resolver
**Objective**
Implement the code path that resolves a bot's MDX settings into usable S2 config.

**Work**
- add resolver modules
- bind bot ID to the right MDX source
- produce normalized S2 settings output from MDX input
- keep the resolver deterministic and testable

**Output**
- working MDX mapping resolver

**Validation**
- Bot1 resolves through MDX mapping into normalized S2 settings
- wrong or missing MDX source fails clearly
- malformed MDX input fails clearly

---

### Sprint D4 - MDX Validation and Safety Guards
**Objective**
Prevent bad MDX-derived settings from flowing into live execution unnoticed.

**Work**
- validate MDX-derived settings before use
- enforce required fields and ranges
- flag unsafe or placeholder values
- distinguish hard error, warning, and informational drift

**Output**
- safe MDX validation layer

**Validation**
- invalid MDX values are rejected
- missing required fields are rejected
- suspicious but non-fatal values are surfaced as warnings

---

### Sprint D5 - Per-Bot MDX Binding for Bot1-Bot8
**Objective**
Scale MDX mapping structure from one bot to all 8 bots.

**Work**
- define MDX source refs for Bot1 through Bot8
- ensure each bot resolves to the correct MDX source
- keep the mapping inventory explicit
- preserve enabled or disabled bot control

**Output**
- 8-bot MDX binding readiness

**Validation**
- all 8 bots resolve their MDX source refs
- no bot/source ambiguity exists
- wrong binding fails clearly

---

### Sprint D6 - Runtime Integration of MDX-Derived Settings
**Objective**
Integrate MDX-derived settings into the actual runtime resolution path.

**Work**
- wire MDX-derived config into bot settings resolution
- ensure runtime uses mapped values instead of only the shared placeholder config
- preserve compatibility with existing bot context resolution
- keep fallback behavior explicit

**Output**
- runtime path uses MDX-derived bot settings

**Validation**
- Bot1 runtime resolves through the MDX mapping path
- bot-specific settings are visible in resolved runtime context
- bad MDX mapping blocks use cleanly

---

### Sprint D7 - MDX Mapping Audit and Operator Review
**Objective**
Review whether MDX mapping is ready for broader live use.

**Work**
- review source model
- review mapping schema
- review validation behavior
- review runtime integration
- review per-bot mapping inventory
- identify remaining blockers before Milestone E

**Output**
- MDX mapping readiness assessment

**Validation / Decision Output**
- produce a concrete result such as:
  - Ready for Bot2 MDX-backed activation
  - Ready for limited multi-bot MDX-backed resolution
  - Not ready; blockers listed

---

## Recommended execution order

1. D1 - MDX Settings Source Model
2. D2 - MDX-to-S2 Mapping Schema
3. D3 - MDX Mapping Resolver
4. D4 - MDX Validation and Safety Guards
5. D5 - Per-Bot MDX Binding for Bot1-Bot8
6. D6 - Runtime Integration of MDX-Derived Settings
7. D7 - MDX Mapping Audit and Operator Review

---

## What Milestone D should achieve by the end

By the end of Milestone D, S2 should have:

- a defined MDX settings source model
- a documented MDX-to-S2 mapping schema
- a working mapping resolver
- validation and safety guards for MDX-derived settings
- Bot1 through Bot8 MDX source bindings
- runtime integration for MDX-derived settings
- a final readiness review for limited live use

---

## Success criterion

Milestone D is successful when S2 can resolve the correct MDX-aligned settings for the correct bot in a way that is:

- explicit
- validated
- auditable
- safe enough for controlled live use

without silently falling back to ambiguous global defaults.
