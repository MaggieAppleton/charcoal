---
name: maggie-design
description: Maggie's personal design philosophy — minimalist, progressive, and dynamic. Use when designing or reviewing UI components, pages, or interactions to keep interfaces spare, reveal detail in stages, and preserve meaning and continuity as users interact.
---

# Maggie Design

My personal design philosophy. The core is: **minimalist, progressive, and dynamic.** Interfaces should feel spare, teach through interaction, and behave like live, responsive widgets rather than static documents.

These product UI preferences take precedence over conflicting generic styling
or mandatory-delight checklists. Use [Interface Grammar](../interface-grammar/SKILL.md#review-gate)
to review them against the actual interface.

## Keep useful text

- **No unnecessary labels or instructional text.** Familiar interactions rely on muscle memory: omit prose such as "Enter to save", "Esc to cancel" and "click here". A discreet trailing key glyph can be useful; keep actual validation errors and information needed to decide.
- **Avoid redundant labels.** Omit a "Calendar" heading when the component and context already identify it. Keep object names, outcomes, units, and labels needed to interpret data or distinguish actions.
- **Icon-only suits compact, at-rest and dense views.** On expanded or detail surfaces (an open document, pane or editor), short labels that name a field, such as "Confidence", "Supports 2" or "What would change my mind", are welcome when they make the surface clearer. They name; they never instruct.
- **Prefer tooltips for secondary labels or guidance.** Use an icon or compact control with a tooltip instead of adding more text directly on the page.
- **Use labelled actions where their meaning needs text**, including unfamiliar actions and menu choices. Use familiar icons with accessible names and tooltips for compact secondary controls.
- **Use small, recognisable marks for familiar statuses.** A blue dot for new, a hollow ring for empty or open, a red dot for a challenge or error-like state. Each mark keeps one established meaning across the app and has an accessible name and tooltip. An unexplained avatar or dot cannot carry an essential state by itself. Keep errors and consequential state understandable without hover or colour alone; show each status once in its context.
- **Keep metadata terse.** Use relative times such as `4d` or `2w`, with the exact time in a tooltip. Put separate facts on separate lines or group them with spacing; never use dot separators (`·`, `•`). Navigation lists default to titles; add metadata only when it helps the navigation task.

## Use the design system

- **Reuse the existing primitive and its variants.** Size a button by selecting its size variant, rather than overriding its text or internal padding. Extend the shared variant when the needed size is missing.
- **A project's decided grammar wins.** Where `design/grammar/RULES.md` exists (see [Design Bench](../design-bench/SKILL.md)), follow it; these preferences are the starting stance for its proposals.
- **Use tokens for colour, type and spacing.** Add a missing value to the system instead of introducing a local literal. Neutrals come from the palette too.
- **Work from real evidence.** Inspect the actual data shape before designing states. Match agreed references and real product mockups faithfully; make differences a deliberate decision.

## Progressive disclosure

- **Summary before detail.** A collapsed component identifies the object or group and shows the count or status relevant to the task. Expansion reveals named items, outcomes, and supporting detail while preserving that context. See [REF-006](../visual-explanations/references/index.md#ref-006--document-completion-scorecard) and [REF-020](../visual-explanations/references/index.md#ref-020--agent-tool-activity-with-summary-and-timeline).
- **Elements appear only when needed.** To reveal more, morph the thing itself (a chip grows into a card, a card into a pane) rather than popping something new in elsewhere.
- **Restraint on hover.** A passing cursor gets only a subtle signifier. Bigger reveals and expansions happen on click, focus or a deliberate long hover. Hover may reveal secondary affordances and previews, never a field's name, its value or its main control on an expanded surface; those stay visible at rest.

## Hierarchy and type

- **Levels of objects must be unmistakable**, e.g. a container concept versus the items inside it. Use scale, weight, grouping and space, not colour alone.
- **Make relationships visible.** Use shared axes and consistent units for comparison, nesting for ownership, and proportional marks for quantities. Keep exact values available alongside visual summaries. See [REF-002](../visual-explanations/references/index.md#ref-002--transaction-allocation-modal), [REF-015](../visual-explanations/references/index.md#ref-015--customer-scatter-plot-across-selectable-groupings), and [REF-021](../visual-explanations/references/index.md#ref-021--agent-run-trace-with-nested-spans-and-playback).
- **Concentrate emphasis.** Keep surrounding chrome quiet; strong colour and contrast identify the important value, action, selection, category, or exception. Give colour a consistent meaning and reinforce it with text, shape, or position. Secondary text must remain readable. See [REF-018](../visual-explanations/references/index.md#ref-018--theme-and-component-editors-with-visible-previews) and [REF-021](../visual-explanations/references/index.md#ref-021--agent-run-trace-with-nested-spans-and-playback).
- **Inter** is a good default typeface for dense product UI.
- **Keep type readable and the scale small.** Body and secondary text usually want to be around 14px. Use two or three sizes within a component, distinguishing peers with weight and colour. Use the project's scale; justify smaller text by its role and legibility.
- **Icons follow their text.** Match the adjoining text scale and align their visual centres on single-line rows. On multiline blocks, align the icon and trailing arrow to the first line, including when optional descriptions disappear.

## Compact composition

- **Condense without squeezing.** Tighten spacing between related controls; keep more space between unrelated groups. Preserve padding around chip text, gaps beside icons, horizontal hover padding and usable hit areas.
- **Align the edges that explain the structure.** Top-right actions sit equally inset from both edges, usually tighter than the content padding. Connector lines touch their endpoints; dividers span the region they divide.
- **Use restrained colour.** Prefer soft, desaturated fills and subtle borders from the palette. Never use a coloured left-hand margin, border or accent bar. Remove divider lines when spacing already makes the grouping clear.
- **Keep shapes coherent.** Smaller controls get smaller radii; pills are fully rounded. Hover paint follows the element's radius. Selected states stay obvious without relying only on a checkmark.
- **Focus marks keyboard navigation on the visible component.** Use the [focus construction rules](../interface-basics/references/construction.md#focus-belongs-to-the-visible-component) for rounded blue or brand-accent indicators, composite fields and pointer/keyboard switching.
- **Keep actions with their object.** Component-wide actions belong at its top. Adding an editable item also focuses its input. A review request links directly to the thing to review.
- **Choose disclosure by task.** A contextual preview can name related items near its trigger before opening their destination; an inline expansion suits continued work on the same object. Follow the object's grammar rather than applying one pattern everywhere.

## Controls beside consequences

- Keep a control, its current value, and the content it affects together. Preview reversible adjustments immediately, with a clear boundary between preview and commit. Show the result of an action on or beside the affected object. See [REF-005](../visual-explanations/references/index.md#ref-005--smart-light-control-panel), [REF-017](../visual-explanations/references/index.md#ref-017--kanban-board-with-tilting-drag-cards), and [REF-018](../visual-explanations/references/index.md#ref-018--theme-and-component-editors-with-visible-previews).

## Dynamic, alive components

- Use **natural, organic animations** so components can grow, shrink, and shift to accommodate additional information or changing data.
- Aim for a **fluid, live-widget feel** — similar to how iOS components feel dynamic and alive.
- **Preserve identity through change.** Expansions originate at their trigger; dragged objects retain a visible slot or insertion marker; regrouping keeps objects recognisable. Keep persistent context still while changing parts move. See [REF-015](../visual-explanations/references/index.md#ref-015--customer-scatter-plot-across-selectable-groupings), [REF-017](../visual-explanations/references/index.md#ref-017--kanban-board-with-tilting-drag-cards), and [REF-019](../visual-explanations/references/index.md#ref-019--action-menu-comparison-with-expanding-pills).
- **When in doubt, animate the change.** Keep feedback responsive and interruptible, and honour reduced motion while preserving state and spatial relationships.
- **Delight is optional.** Confetti, sounds, and Easter eggs can suit a brief; they are not completion requirements. Make the action's effect clear and satisfying first.
- **Design the return as well as the reveal.** Opening and closing transitions stay coherent for pointer and keyboard triggers. Follow `interface-grammar` for origins and interruptibility.
- **Scale press feedback to the element.** A small button can shrink subtly; a large card should barely move.
- **Loading reflects what is known.** Use a structural skeleton, shimmer or sweep for indeterminate work; a filling progress bar needs real progress. Avoid tiny or square dot sequences.
- **Keep scrolling content legible.** Use slim, light scrollbars and the project's subtle boundary or approved fade where a sticky header covers scrolling content.

## Design states together

- Review applicable default, hover, focus, selected, disabled, loading, empty, and error states side by side, including narrow layouts. Exercise the transitions as well as inspecting stills. Use a plain HTML jig with vanilla Dial Kit controls when tuning values. See [REF-018](../visual-explanations/references/index.md#ref-018--theme-and-component-editors-with-visible-previews) and [REF-023](../visual-explanations/references/index.md#ref-023--mobile-messaging-prototype-with-scenario-controls).

## Generative UI

- Assume agents can pick the right component from a library for a given situation. Design components to be composed into answers and views, not only fixed screens.

## Reference

- [Dot by New Computer](https://web.archive.org/web/20231106171857/https://new.computer/) (Jason Yuan): a calm, alive, conversational interface.
