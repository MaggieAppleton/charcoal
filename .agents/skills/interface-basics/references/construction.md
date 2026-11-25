# Construction

Use these values as coordinated starting variants in a new product. Existing project tokens and agreed variants take precedence. **Reference** means measured Clean construction; **adaptation** means a deliberate product default for Maggie.

## Controls are coordinated sets

CSS pixels; label values are font-size/line-height. The glyph box holds visible artwork; the control's target is larger.

| Role | Height | Label | Glyph | Text-side inset | Icon-side inset | Gap | Radius | Basis |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Small action | 24 | 12/16 | 14 | 8 | 6 | 4 | 6 | Reference; compact exceptional role |
| Default action | 28 | 13/20 | 16 | 10 | 8 | 6 | 6 | Reference; ordinary desktop actions |
| Larger action | 32 | 13/20 | 16 | 12 | 10 | 6 | 6 | Reference; more surrounding space |
| Field / select trigger | 32 | 13/20 | 16 | 10–12 | Match primitive | 6–8 | 8 | Repeated reference family |
| Single-line menu option | 32 | 13/20 | 16 | 8 | 8 | 8–10 | 6 | Reference; within padded menu |
| Two-line choice | At least 44 | 13/20 + supporting role | 16 in identity slot | 8 | 8 | 8–10 | 6 | Reference; grow for wrapping |

Button and Segmented Control independently repeat 24/28/32px heights with matching type/glyph sets. The 2px icon-side reduction is optical balance built into the variant, not a local nudge. Larger buttons keep the same 13px label as default buttons. A larger object does not automatically need a larger glyph.

An icon-only default action is 28×28 around a 16px glyph. Keep its accessible name and a familiar meaning; unfamiliar actions need a visible label. A 20/22/24px identity slot can contain a 16px glyph while a separate 28px action sits beside it.

**Touch adaptation:** preserve a comfortably usable, nonoverlapping hit area, normally at least 44×44 CSS px for primary touch actions, without enlarging every glyph. A dense desktop target can keep its visible shape within a larger interaction region. Mobile text inputs use at least 16px input text where needed to prevent browser focus zoom. Visible size, hit size and input text are separate decisions; a resized desktop viewport is not a touch test.

Example of a centrally defined default variant, to map into the host Button rather than paste over its internals:

```css
:root {
  --action-height: 28px;
  --control-type: 13px;
  --control-line: 20px;
  --control-glyph: 16px;
  --action-inset: 10px;
  --action-icon-inset: 8px;
  --action-gap: 6px;
  --action-radius: 6px;
}
.action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--action-gap);
  height: var(--action-height);
  padding-inline: var(--action-inset);
  border-radius: var(--action-radius);
  font: 500 var(--control-type)/var(--control-line) var(--font-ui);
}
.action[data-leading-icon] { padding-inline-start: var(--action-icon-inset); }
.action__icon { display: block; flex: none; width: var(--control-glyph); height: var(--control-glyph); }
.action__label { min-width: 0; }
```

Acceptance: adjacent peers have equal computed height, label line height and glyph boxes. Pending/selected states retain those dimensions unless an intentional measured morph changes the content width. A control label never needs an instance-level font/padding override to fit its variant.

## Type follows the reading task

| Role | Starting type | Application |
| --- | --- | --- |
| Reading / meaningful secondary text | 14/22 | Maggie adaptation; chat reading surfaces support approximately 14/22.4 |
| Component title | 15/24, medium | Repeated compact reference title; use weight before another size |
| Control / dense single-line label | 13/20, medium where needed | Compact action, field and menu reference |
| Terse metadata | 12/16 | Explicitly justified supporting role; essential descriptions use reading size |
| Dashboard value | 20/28 | Reference dashboard role; standalone KPI may use 24/32 |

Use two or three sizes within one component. Peers keep the same size and weight across selection; a moving fill, edge or contrast change carries state without changing text width. Numeric comparisons use tabular figures and aligned tracks, with units/denominators visible.

Example: a review card can use a 15/24 title, 14/22 explanation and 13/20 action. It does not need separate sizes for every badge, line and state. A 12px timestamp is a supporting exception, not permission to shrink the explanation.

Acceptance: ordinary reading remains around 14px at narrow widths; metadata has an identifiable supporting role. The same semantic role has the same token across cards, menus and expanded states. Optional descriptions disappearing do not shift the title/icon alignment.

## Derive the content axis

Single-line controls use centered flex alignment and block SVGs. Multiline rows align their identity and trailing affordance with the first line, using a slot matched to that line box. Preserve that slot when the description is absent.

For a menu, 4px frame padding + 8px row padding = a 12px text-content axis. Header/footer use the same 12px inset. For a comment, 20px avatar + 8px gap = 28px inset for body/actions. For a status row, 16px marker + 10px gap = 26px for detail text. Change the slot and its derived inset together.

```css
.menu { padding: 4px; border-radius: 10px; }
.menu__heading { padding-inline: 8px; }
.menu__row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 20px;
  align-items: start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
}
.menu__mark, .menu__arrow {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
}
.menu__title { line-height: 20px; }
```

The example's 20px slots align with its 20px first line; glyphs inside remain 16px. Use the corresponding slot/line relationship for a different type variant. Let the row grow when supporting text wraps.

Acceptance: titles, body and footer align through arithmetic that survives changed icons, long descriptions and missing descriptions. Every hoverable row has left/right padding inside one continuous hover surface. An inner action uses a separate control only when it performs a distinct action.

## Space by relationship

Start with 2px title-to-description, 4–6px between adjacent action buttons, 6–10px for related icon/text or identity/text, 12px before a separate action group and 16px card content padding. Settings section rhythm can use 36px. These are role relationships, not a demand that every gap match one number.

Example: title → 2px → description → 12px → actions makes the title/description one group. Two actions within that group use 4px, an adaptation to Maggie's preference for tight button pairs. Independent sections need a visibly larger gap than the contents within each section.

Acceptance: grouping remains obvious without adding redundant headings or divider lines. Chips retain breathing room above/below text, icon gaps stay visible and right padding matches the chosen variant. Top-right component actions have equal top/right insets.

## Give each surface an edge and elevation

Define these as palette-aware tokens. Compact control reference:

```css
--shadow-control:
  0 0 0 .5px rgb(0 0 0 / .06),
  0 1px 1px -1px rgb(0 0 0 / .10),
  0 1px 2px rgb(0 0 0 / .05);
--shadow-popover:
  0 0 0 .5px rgb(0 0 0 / .08),
  0 12px 28px -10px rgb(0 0 0 / .16),
  0 1px 2px rgb(0 0 0 / .05);
```

Example: a secondary button uses the control token; a floating menu uses the popover token. Both already include a hairline, so adding another border would double the edge. A quiet resting content card can use only a subtle 1px edge; depth is assigned by layer, not added to every nested region.

Radius starting roles: action/row 6, field/tray 8, compact card/menu 10, larger command surface 12, writing composer 16, pill fully round. A menu's 10px outer radius fits its 6px row radius + 4px inset; richer cards need their own role, not an automatic subtract-padding formula.

Dark themes use local dark surfaces and white hairlines with separately tuned shadows. Reuse the project's palette; create missing tokens centrally. Restrained semantic fills keep one meaning per status and remain understandable without color alone.

Acceptance: each edge is applied once; hover paint follows the row/control radius; floating surfaces separate from content without a muddy halo. Inspect both themes against the actual backdrop, including selected, disabled and focus-visible states.

## Focus belongs to the visible component

**Maggie adaptation:** focus indicators mark keyboard navigation. Pointer clicks, taps, hover and ordinary typing after a pointer click retain the component's resting shape. Use a restrained, clearly visible blue focus token by default, or the agreed brand accent, tuned for light and dark surfaces. A crisp 2px indicator is a useful starting point; follow the component's rounded corners, leave a little separation and keep it unclipped.

Choose the visual owner before styling focus. A search field with a leading icon, a composer with its toolbar, or the todo app's plus/input/add row reads as one component. The enclosing surface owns the indicator; its transparent inner input keeps its caret and accessible name without acquiring a separate box. A standalone field owns its own indicator. Distinct buttons within a composite retain their own focus target. Keep focus paint out of layout so geometry stays stable.

Inline editing preserves the object's resting text axis, type, wrapping and surrounding actions. Make the text editable within that same surface; keep the inner editor transparent and borderless, and put keyboard focus on the complete row/container. A trailing menu stays inside that component's padded surface. A validation error can add necessary feedback, but entering edit mode alone should not add a nested field frame or instructional line.

Use the host's focus-ring/modality primitive when available. `:focus-visible` alone is **not keyboard-only for text inputs**: browsers can match clicked editable fields too. For this preference, combine it with interaction modality. Pointer-down suppresses the navigation indicator; Tab and control-navigation keys restore it. Typing, cursor movement and IME composition inside a clicked text field do not switch it on. Programmatic focus inherits the action's modality, including menu opening, edit/save/cancel and focus recovery. Preserve visible keyboard and assistive-technology focus; native `:focus-visible` is the fallback before a modality has been established.

For example, with a host-provided `data-focus-modality` attribute:

```css
.composer { border-radius: 8px; }
.composer > input:focus { outline: none; } /* Replaced on the visual owner below. */
:root:not([data-focus-modality="pointer"]) .composer:has(> input:focus-visible) {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

Acceptance: click/tap into the field and type — no navigation ring or exposed inner rectangle. Tab/Shift+Tab into it — one rounded indicator encloses the intended component, with no inner ring. Tab to a distinct child button — the indicator identifies that button. Exercise pointer→keyboard→pointer changes, keyboard menu movement, click-opened inline editors and save/cancel focus recovery in both themes. Hover, selection and validation keep their separate meanings.

## Evidence

Core size families: [Button](https://www.affectui.com/components/button), [Segmented Control](https://www.affectui.com/components/segmented-control), [Combobox](https://www.affectui.com/components/combobox), [Stepper Form](https://www.affectui.com/components/stepper-form). Axes/surfaces: [Profile Menu](https://www.affectui.com/components/profile-menu), [Filter Menu](https://www.affectui.com/components/filter-menu), [Comments Panel](https://www.affectui.com/components/comments-panel), [Tool Call Card](https://www.affectui.com/components/tool-call-card), [Chat Composer](https://www.affectui.com/components/chat-composer), [Analytics](https://www.affectui.com/screens/analytics), [KPI Chart](https://www.affectui.com/components/kpi-chart). Reading defaults, tight action-pair gaps and touch target guidance are explicit adaptations, not claims that every Affect component uses them.
