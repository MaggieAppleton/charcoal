# Component recipes

Read the relevant family, then implement it through the host primitive and [construction tokens](construction.md). Dimensions below are Clean reference values; readable prose, touch targets and disclosure behavior follow the explicit adaptations in this skill. Each recipe includes a concrete example and a completion condition.

## Action and selection

**Action:** use the complete default 28px action variant. A leading glyph occupies a fixed 16px box; text yields width first. Pending keeps the button's identity and focus, reports busy, and prevents duplicate activation; resolved feedback belongs beside the affected object. Example: Save → Saving → Saved uses the same control, with failure retaining the draft and providing Retry. Complete when keyboard activation, duplicate protection, failure and cancellation preserve a meaningful focus location and truthful status.

**Peer selection:** use Tabs for associated views, radios for form values and a segmented control for a few immediate peer choices. Keep labels at the same weight; move one selected surface instead of resizing every label. Tray reference: 8px outer radius, 2px inset, 6px indicator radius. Example: Overview/Activity/Files retains one selected view and one appropriate Tab entry. Complete when arrows/selection match the primitive's semantics, disabled options are skipped and overflow keeps the active choice reachable.

## Menus and contextual previews

**Action menu:** shared Menu primitive, surface radius 10px, frame padding 4px, option 32px high/radius 6px, 8px side padding, 16px glyph in a consistent identity slot. Anchor about 6px from the trigger and use the floating shadow. A 36px command option is a separate action-search role, not a reason to enlarge ordinary menus. Example: a project menu aligns Rename, Duplicate and Archive on the same text axis. Complete when rows have one padded hover surface, usable keyboard movement, collision-aware positioning that stays attached during page/ancestor scrolling, and Escape/outside dismissal with appropriate focus return.

**Contextual item preview:** count in the trigger; actual item title, semantic icon/color and decorative arrow in each row. The whole row opens one destination. Use the same common text/icon scale as other product rows; grow rows for readable wrapping. Example: “3 sources” opens three named sources, not another count or generic explanation. Hover-opened previews dismiss on pointer exit; clicked previews dismiss outside/on Escape. Keep the trigger and panel traversable as one hover region. Complete when every item is named, pointer and keyboard can reach it, and the panel stays concise without redundant headings or a corner close button.

**Search/select:** shared Combobox with 32px minimum field/radius 8, 4px chip/list gaps, 24px chips and the menu geometry above. Protect input space before collapsing extra values to +N. Example: selected people show names/chips plus an overflow count, with the full selection available in the list. Complete when query, highlighted option and committed value are distinct; no-result/create paths are explicit; removing a chip and closing retain focus.

**Inline disclosure:** use the shared shadcn/Base UI Accordion with the project's Chevron. Header content, chevron and expanded text follow derived content axes. Example: a run summary expands its named steps beneath the same object. Complete when open/close are coherent, a closed panel is removed from keyboard traversal, and collapsing focused content returns to its header. Choose a contextual preview instead when the task is to inspect related objects and navigate elsewhere.

## Fields and ordered forms

**Field:** 32px/radius 8 reference, 10–12px text inset; preserve label, value, error and help associations. Use readable help where it explains a necessary decision. Example: a workspace URL prefix shares one field surface, with padding applied once at the text boundary. Complete when the field has a real accessible name, long values remain editable and a failed submission focuses the first invalid field with its error attached.

**Inline editing:** preserve the displayed text's type, insets and wrapping; the existing row is the editing surface. Use a transparent editor and the [outer focus owner](construction.md#focus-belongs-to-the-visible-component), keeping the checkbox and trailing actions on their original axes. Familiar Enter/Escape behavior needs no instructional sentence; a small trailing key glyph is optional when useful. Complete when entering/cancelling edit preserves geometry, long titles grow naturally, keyboard focus surrounds the row and real validation errors remain associated with the editor.

**Settings row:** label/help at left, control at right; reference rows 60px, page width 760px, sections 36px apart. Stack label/control at narrow widths and keep retained values independent of whether a control is currently enabled. Example: pausing instructions disables editing without deleting the text. Complete when changing a setting has a clear scope, its applied effect agrees with its saved state, and essential controls remain available after reflow.

**Ordered form:** one values model across stages; editable review; primary/Back actions use the same action family. Reference pane inset 20px, narrow 16px; fields separated by 16px. Example: Review → Edit workspace returns to the existing workspace value, then back to Review. Complete when Back/Edit preserve drafts, the new stage receives focus, validation identifies the first error and final success is tied to the actual operation.

## Cards, review and activity

**Ordinary card:** radius 10px, content inset about 16px, title/description gap 2px, separate action group about 12px later. Let descriptions grow while peer actions share an axis. Component-wide actions sit with the component heading. Example: a task card preserves title, state and next action while optional details disclose. Complete when peer cards use shared tokens, long content wraps intentionally and nesting adds a frame only for a distinct object/layer.

**Decision card:** name the exact proposed object/effect, supporting evidence and scope beside the choices. A spacious variant can be explicit: Approval Card uses radius 16px, 16px inset and 34px/radius-10 actions. Example: “Send campaign email” resolves to a receipt naming that same email/action. Complete when recommendation, selection and execution remain separate, pending/failed/success states are real, and every resolving path leaves focus on a stable control or receipt.

**Activity/timeline:** derive detail indentation from the marker/identity slot plus gap. Reference examples use 16+10=26px or 20+8=28px. Keep marker, text and connector geometry separate; connectors meet endpoints. Example: an agent step retains its name while a spinner becomes a result and details expand under its text axis. Complete when collapsed/expanded entries share that axis, status has a textual equivalent and retries distinguish the logical job from its execution attempts.

**Feedback:** keep notifications near their affected context; preserve action identity and a valid Undo/Retry route. Example: an individual diff decision focuses Undo; bulk completion must receive the same independent check. Complete when cancellation, pending, success and failure all retain meaningful focus and outcome copy agrees with what the host actually completed. A demo timer or toast is insufficient evidence of save, send, copy, export or permission.

## Reading and composition

**Composer:** radius-16 writing shell with separately aligned text, toolbar and context tray; 28px toolbar targets around 16px glyphs. Reference toolbar gaps are 4px within a group and 8px between groups. Use the reading type role for real prompt content. Example: model selection changes the model while keeping the message draft and Send location stable. Complete when multiline growth, Shift+Enter, narrow toolbar grouping, menu cancellation and failure preserve the draft and focus.

**Answer/document:** reading text around 14/22 with deliberate paragraph/list rhythm; compact 13/20 controls remain separate. Use source strips for visual previews and count disclosure for compact identities. Example: clicking a citation opens the corresponding named passage without replacing the answer or silently changing a committed choice. Complete when long prose, inline controls, citations and feedback share readable axes and narrow reflow keeps both the reading context and full source names available.

**Empty/loading:** start from the geometry of the content that will arrive. Example: a 36px avatar skeleton, aligned name/body bars and media placeholders resolve without moving the main axes. Complete when busy clears, state copy updates, real values are retained, and indeterminate work does not impersonate measurable progress. Delay a skeleton for very short waits; keep the static reduced-motion state meaningful.

## Data and coordinated views

**Table:** preserve comparison tracks inside a deliberate scroller. Reference Data Table: minimum 600px, 40px rows, 12px cell side insets; header alignment derives from 6px cell + 6px sort-control padding. Example: a narrow 316px card scrolls its 600px table instead of shrinking all labels. Put empty/error messages outside wide comparison tracks, or deliberately bring them into view: a zero-result message at the left of an already-scrolled table can be invisible. Complete when the final column and empty/error states are reachable, header/body axes match and active cell, row selection and editing remain separate with logical focus after sorting.

**Metric/chart:** show unit, denominator, scope and exact values independently of animated marks. Dashboard value reference 20/28; standalone KPI 24/32. Example: a usage fraction names used/allowance, while a category share names category/used. Complete when zero, missing, unlimited and negative values remain distinct, comparison states name their baseline, and keyboard/text access supplies meaningful values available on hover.

**Multiple actors/attempts:** choose the geometry for the relationship. Example: lanes explain overlap in time; a tree explains ancestry; a relay explains sequential transfer; a matrix compares alternatives; stable cells track independent work. Complete when object identity survives reordering/retry, the axis is named, and best-scoring, selected and applied outcomes remain distinct.

## Evidence

Actions/selection: [Button](https://www.affectui.com/components/button), [Segmented Control](https://www.affectui.com/components/segmented-control). Menus/forms: [Profile Menu](https://www.affectui.com/components/profile-menu), [Combobox](https://www.affectui.com/components/combobox), [Command Menu](https://www.affectui.com/components/command-menu), [Stepper Form](https://www.affectui.com/components/stepper-form), [Settings / General](https://www.affectui.com/screens/settings-general). Composition: [Chat Composer](https://www.affectui.com/components/chat-composer), [Approval Card](https://www.affectui.com/components/approval-card), [Data Table](https://www.affectui.com/components/data-table), [Usage Meter](https://www.affectui.com/components/usage-meter), [KPI Chart](https://www.affectui.com/components/kpi-chart), [Analytics](https://www.affectui.com/screens/analytics). The full source-repository archive records the remaining component-specific measurements, exceptions and state limits.
