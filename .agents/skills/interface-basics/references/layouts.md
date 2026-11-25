# Layout and responsive composition

These are examples of relationships to adapt, not mandatory page templates. Reuse host layout tokens; a different product can need a different structure while retaining consistent controls and axes.

## Match usable content axes

Measure the content after padding, not just the outer wrapper. AI Chat / Agents aligns a 680px reading column with a 744px composer minus two 32px insets. This is the relationship to preserve; giving both wrappers 680px would misalign their contents.

Example: define one reading-width token, derive the writing wrapper as reading width + two insets, and align the inner text edges. At narrow widths, reduce the outer insets or let the wrappers share available width while keeping reading type stable.

Acceptance: the reading and composing text start/end on the intended shared axes, including multiline content, visible scrollbars and a narrow viewport. An embedded preview's zoom is excluded from CSS token measurements.

## Keep shell tracks explicit

Reference shell: navigation starts at 272px, optional workspace pane at 360px, center flexible with min-width 0. Inset adds 8px outer margin and 12px main-surface corners; Flat omits that framing and uses one structural division. Top bars use explicit 48px/52px role variants.

Example: model navigation/main/workspace as three tracks. At narrow widths, keep main usable and turn secondary panes into drawers. A drawer opens near its invoking control, owns focus/modality appropriately and closes back to that control.

Acceptance: the main area can actually shrink; secondary tracks stop consuming desktop space when they become overlays. A container query targets a descendant of its query container, not that container itself. Test desktop collapse as well as mobile dismissal: correct drawer focus does not prove correct desktop collapse.

## Choose reflow by relationship

| Relationship | Arrangement to try | Concrete example | Acceptance |
| --- | --- | --- | --- |
| Independent list and detail | Stack or open detail in a pane/drawer | Template picker keeps query/selection while detail moves below | Current object, full text and Back/dismiss remain reachable |
| Comparisons needing stable columns | Scroll one contained region | 600px table inside a 316px card | Keyboard/scroll reaches the last column; headings remain associated |
| Parallel stages | Contained board plus a complete list/detail route | Kanban keeps roughly 248px columns and a narrow list alternative | Status can change without drag; focus returns to the originating card |
| Setting label and control | Stack, expand field to available width | General/Profile field moves below its label | Text size stays readable; value/error stays attached to label |
| Timeline + exact quantities | Stack timeline below names/primary numbers | Cost/Trace Waterfall keeps meaningful values while secondary columns yield | No essential editing/decision route disappears with a hidden column |
| Source thumbnails | Scroll preview strip | Answer sources retain useful card widths | Full source names/details are reachable without unreadable thumbnails |
| Compact selected identities | Collapse excess into a named count trigger | Combobox chips plus +N | Opening names every selected object, with removal/selection routes |
| Connected diagram | Recompute geometry after layout changes | Integration Beam changes left/hub/right to above/hub/below | Paths still meet the actual nodes; labels and state remain readable |

Reduce supporting chrome before identity and decision content. A description that explains a consequential choice needs wrapping or full disclosure, not silent truncation. Removing an editing column requires an alternative editing route.

## Put controls at their real scope

Shared controls sit above the objects they affect; local controls stay within their object. KPI Board's date range affects the whole board, while a segment inside the overview card affects only that chart. Pricing Plans uses synchronized feature disclosure across comparison cards.

Example: a dashboard range change updates every dependent metric/list with a coherent scope label, while a local chart mode leaves independent lists explicitly labelled. Keep recommendation, draft choice and applied result as separate states.

Acceptance: changing one control updates exactly its intended data. Version/model/suite/baseline are bound consistently; a partial demo update must not become a production data contract. A quote interval and an actual invoice remain different records.

## Avoid duplicate framing

A card embedded inside an already-owned panel may need its content rather than another full border, title and shadow. Run embeds its plan without the standalone frame. Use nesting to express a distinct object or layer, rather than repeating container decoration.

Example: a sidebar section supplies the heading; the embedded list aligns beneath it without repeating the heading inside a second card. A selected object can still have a clear local surface.

Acceptance: every frame/heading communicates a different scope. Grouping remains clear with the fewest layers needed, and actions stay attached to their object.

## Check actual bounds

Compute usable width as container width minus padding and reserved tracks. Inspect the nearest overflow/clip owner as well as the document. Tilt Card's reference sample remains 340px in 316px usable space and is clipped despite no document overflow.

Example: in a 348px surface with 16px side padding, test the child against 316px, then inspect its right edge and focus ring while open/selected. For a popover, inspect viewport collisions and every ancestor that could clip it.

Acceptance: names, values, controls and focus rings are visible or intentionally reachable through a labelled scroller/disclosure. Test one long title, wrapped description, largest practical value and empty state, not only the demo's short text. Test empty/error results after scrolling to the final comparison column; messages belong in reachable viewport space rather than an offscreen cell.

## Keep artwork separate

Illustrations can use proportional artboards, masks, occlusion and layered materials. Working controls keep readable type and usable targets outside that proportional scaling. The map selectors and Layer Stack show why: miniature artwork can turn a real label into roughly 7–8px text.

Example: put a static relationship illustration beside a normal labelled selection list; the selected object controls the visual. Keep one semantic text representation and hide duplicate artwork. A decorative loop is not evidence of connection, message delivery or live progress.

Acceptance: the still version communicates the relationship; real selection/state is available without motion, hover or color alone. Optional gradients, glass, orbit and tilt serve a brief and remain separate from everyday control elevation.

## Evidence

[AI Chat / Agents](https://www.affectui.com/screens/agent-chat), [App Shell Inset](https://www.affectui.com/screens/app-shell), [Settings / General](https://www.affectui.com/screens/settings-general), [Kanban](https://www.affectui.com/screens/kanban), [KPI Board](https://www.affectui.com/blocks/kpi-board), [Integration Beam](https://www.affectui.com/illustrations/integration-beam), [Layer Stack](https://www.affectui.com/illustrations/layer-stack), [Tilt Card](https://www.affectui.com/motion/tilt-card). Public previews are construction evidence; original Pro implementations were unavailable.
