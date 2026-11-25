# Charcoal implementation plan

**Goal:** Deliver the approved illustration workspace as a working browser app for one user.

**Architecture:** A standalone React/TypeScript browser interface and a local service. The service owns durable board, assets, style versions, jobs and review results. Use SQLite and an image directory. Keep the canvas engine replaceable and the generation and review adapters independent.

**Spec:** `design/approved-mockup.html` is authoritative for the interface. `design/product-plan.md` supplies the functional scope.

## Visual acceptance

- [ ] Open the approved mockup before building the UI and capture its board, attachments, settings, prompt preview, painted edit area, expanded rule editor, and result/review states at matched desktop and narrow widths.
- [ ] Build the same surfaces and controls. Preserve the actual text, artwork scale, icon family, quiet canvas, bottom prompt, evolving selection indicators, selected-image toolbar, brush feedback, rule forms and contextual evidence. The visible canvas belongs to the artwork. Reuse the approved values and patterns directly when practical.
- [ ] Exercise the equivalent states in the real app. Compare matched screenshots side by side and review keyboard focus, wrapping, clipping, reduced motion, input and dismissal. Check a populated board as well as an empty board.
- [ ] Do at least two distinct passes of UI bug finding, fixing and verification across the integrated workflows. Use a design reviewer for fidelity and record the changes and remaining differences. Take fresh screenshots after fixes.

## Build sequence

### 1. Board, assets and persistence

- [ ] Prove the engine can deliver the approved canvas interaction without showing its default chrome. Validate licensing, then define the board coordinate and image geometry interfaces before implementation.
- [ ] Import multiple images in one drop, file selection or paste, retain each source aspect ratio and original bytes, and show them together. Implement pan and zoom, selection, rearrangement, resize, undo, and simple drawing and annotation. Keep zoom and drag distinct from clicking to attach.
- [ ] Wire the durable board and asset store. Reload with imported assets, moved objects, selections and zoom state, then verify the relevant state is restored.

### 2. Prompt, requests, and run records

- [ ] Attach and remove images by selection in the approved prompt flow. Give each thumbnail and its board image a matching input position. Validate eight inputs maximum, including the edit target. Exercise attach, remove, ninth input, and ordering.
- [ ] Keep Sunburst 2.6 generation and editing as the image provider. Expose complexity, quality, size and count. Show the actual effective prompt and settings. Use the Images generations endpoint for text-only and edits for any input images. Keep credentials on the service. Verify current official OpenAI docs before wiring the adapter.
- [ ] Snapshot the request before dispatch and place separate results beside their source or input group. Use recoverable run states. Test API success, error, interruption, refresh and retry, including uncertain paid-request outcomes and preventing duplicate tiles.

### 3. Image edits, brush and protection

- [ ] Attach an edit action to the selected image and support the approved freeform paint and erase interactions, brush size, undo, clear and overlay visibility. Persist guides in image coordinates. Test different source dimensions, orientation, device-pixel ratios, panning and zooming.
- [ ] Implement separate mask and markup request modes and whole-image edits. A mask is a same-size PNG with editable areas encoded in its alpha. Markup is a transparent annotation overlay. Use input image one as the edit target.
- [ ] For painted edits, retain the source and raw response. Map the generation back to source coordinates and blend a lossless candidate in an expanded, feathered neighborhood around the paint. Assert exact decoded pixel equality beyond the blend. Surface an actionable failure if the response cannot be aligned.

### 4. Styles and their checks

- [ ] Create and edit styles, prompt instructions, image checks, enabled flags and example attachments with the approved rule editor. Show rule effects in the effective prompt. Save a new version and verify prior runs still show the original text, settings, references and checks.
- [ ] Run enabled checks on the final candidate. Include rule criteria and examples, record pass/fail/needs review with evidence and location when available, and allow a separate retry when evaluation fails. Keep deterministic pixel checks separate from visual judgment.

### 5. Review, revision and delivery

- [ ] Compare source and result on demand. Inspect check evidence, override a check with a reason, keep a result, and branch a revision into an editable prompt with the correct image and edit area. Exercise image and project export and project reopen.
- [ ] Run end-to-end workflows in a real browser against the integrated service. Use an injectable fixture provider for CI. With existing authorized API access, smoke test text-to-image, multiple image references, protected mask edits, markup and visual checks on task-owned sample art. Report fixture and live results independently. Handle any missing API access through the available credential flow and report it explicitly if still blocked.
- [ ] Run a separate code review for correctness and maintainability, resolve findings, and make a cleanup pass. Re-run build, tests and representative browser scenarios after cleanup. Verify the final effective prompt, mask pixel check and recovered jobs against visible behavior.
- [ ] Document how to launch the app and record the checks performed and any remaining limitations.

## Edge cases to cover

- Non-square and EXIF-rotated images with transparent content.
- Reordering and removing inputs while another run is pending.
- Imported art and masks survive reload, including after a style rule changes.
- Mask strokes align during zoom and after the output is rescaled. The result fades smoothly past the painted boundary and matches the source beyond the blend.
- Failed or uncertain provider calls never masquerade as a passing review or trigger another paid request by themselves.
- Dense attachments and long rule names remain usable at narrow widths and with keyboard navigation.
