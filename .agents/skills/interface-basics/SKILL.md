---
name: interface-basics
description: Builds consistent product interfaces from measured control sizes, text roles, icon alignment, spacing and surface treatments. Use when creating or refining app components, tools or prototypes, especially when buttons, padding, typography or alignment need a dependable baseline.
---

# Interface Basics

Make the small construction decisions consistent so the product can be unfamiliar without its controls feeling improvised. These rules distil Affect UI's Clean reference and Maggie's preferences; they provide a starting grammar, not a dependency on the library.

## Start with the host system

Read the project's Button, field, menu, text and icon primitives and their tokens. Map the needed roles onto those primitives. Add a missing variant centrally so every instance receives the same dimensions. When a project already has an agreed visual system, retain it and apply the relationships below within its scale.

Before writing or changing UI, read [construction.md](references/construction.md). It contains the coordinated size families, alignment arithmetic, type roles, spacing and edge/elevation recipes. Use those defaults when the host has no established equivalent.

Read [components.md](references/components.md) for the family being built: selection, menus, fields, cards, activity, reading/composition or data. Read [layouts.md](references/layouts.md) when composing screens or adapting them to narrow widths. Read [motion.md](references/motion.md) when a state transition, loop or changing value needs continuity. Each reference includes examples and completion conditions; load only the relevant branches.

## Build by role

- Choose the component's object, action and state before its dimensions. A glyph, identity tile and interactive target are separate objects with separate sizes.
- Size a control as a complete variant: height, label/line height, glyph, gap, insets and radius. Peers share that variant; loading and selection preserve their identity.
- Use a small type scale with explicit reading, control and supporting roles. Reading text starts around 14px; compact control labels can be 13px. Keep necessary secondary text readable.
- Derive text axes from padding + identity slot + gap. Center icon/text on single-line controls; align icons and trailing arrows with the first text line in multiline rows.
- Give the complete hover surface padding on both sides. Align sections through their content axes while preserving the padded paint around each row.
- Assign a surface its edge and elevation together. Compact controls, cards and floating menus have different roles; apply the matching token once.
- Put keyboard focus on the visible component boundary. Follow the [focus construction rules](references/construction.md#focus-belongs-to-the-visible-component) for input modality, composite fields and rounded indicators.

## Adapt to the available space

Change arrangement before squeezing type or controls. Stack independent panels, scroll comparisons inside their own region, and disclose supporting detail while retaining the information needed to decide. Verify actual clipping ancestors and usable width after padding; a page with no horizontal overflow can still hide content.

Keep reading text and working controls independent of illustration scaling. Reserve ornamental materials, gradients, tilt and long entrances for an optional accent justified by the brief.

## Check the constructed result

Inspect the real rendered component at its normal width and a narrow width, with representative long content. Check applicable rest, focus, selected, pending, empty and error states, including the transitions between them.

Completion means peer controls have matching geometry, text and icons share their intended axes, hover paint has side padding, surfaces use the intended edge/elevation, and content remains readable and reachable. Verify pending/completion/cancellation focus separately. Preserve final values and state when motion is reduced.

Use existing project tooling for measurement and screenshots. This skill does not install review hooks or require a particular UI framework.

## Provenance

The construction defaults are supported by the [Affect catalog](https://www.affectui.com/components), with explicit adaptations for Maggie. The source repository also contains a [142-item evidence and recipe archive](../../../docs/research/affect-ui/README.md); it is optional research, not a runtime dependency of this skill. Each archived recipe distinguishes published source, public preview measurements, documented behavior and unverified paths. Pro source was unavailable.
