# Canvas removal

This records the existing canvas grammar and its failed-run extension. The approved
mockup remains authoritative for visual values.

| Object | Purpose | State and actions | Lifetime |
| --- | --- | --- | --- |
| Canvas image | Arrange illustration material | Place, attach, move, resize, remove, undo | Saved with its board |
| Run tile | Locate a pending or unsuccessful generation | Open record; remove failed or interrupted tile; undo | Visible until resolved or removed |
| Run record | Retain a generation's request and outcome | Inspect, retry, open results | Retained when its tile is removed |

Canvas objects occupy the base plane. Existing floating controls remain above it;
run details use the existing dialog. Each board can contain many images and runs,
navigated through pan/zoom and the Runs index. Removing a tile frees its canvas space.

The familiar trash icon belongs at the tile's top right with the existing compact
button and tooltip. It stays visible on touch and narrow screens. Hover, press and
focus reuse shared button treatments. Delete and Backspace remove the focused tile;
focus then returns to the canvas. Pending generations have no removal action.

Removal happens immediately and shares canvas Undo/Redo. Visibility is saved in
the workspace, so reload and project export preserve it without erasing history.
No new surface, status colour, animation or confirmation is introduced.

## Prompt blocks

A prompt block stores reusable subject text on one board. It shares the note
editor and canvas movement. Its corner action links or unlinks it from the draft.
Canvas selection and draft membership are independent.

The composer shows linked blocks in send order. Their chips locate, reorder,
or unlink them. The full prompt contains that text followed by the composer's
typed instructions, with image references and style rules composed as usual.
Editing a block updates the draft when saved. Each run stores the composed text
at Send. Prompt blocks stay text when a sketch is flattened to an image.

## Illustration studies and direction

The canvas remains the working surface. Composition thumbnails are small,
grayscale composition and value studies. Attached style references guide shape
language, framing, edges, and light/shadow; multiple references follow the user’s
per-image prose. Midtones and characteristic mark-making remain available.
Studies use the selected rendering quality and high planning complexity.
Each requested variation is
an independent generation with an inspectable brief. Multi-image composition
batches first make one shared multimodal planning call using the complete brief,
style rules, and all ordered reference images. The planner compares the set and
specifies each alternative’s viewpoint, framing, layout, value structure and art
direction. Each renderer receives one concrete alternative. The server persists
the plan under the batch ID and reuses it for retries; an invalid or failed plan
stops before any images are submitted. No static composition recipes or implicit
“alternative N” selection are used. Other variation axes retain their current
content-driven instructions. Saved legacy study directions are ignored. Finished illustrations
can vary composition, colour, style, or lighting. Source-edit wording suggests
a variation axis visibly; an explicit choice wins until reset. Composition is
the default for new images. Single-image requests retain the ordinary brief.

Study and variation controls live in the existing generation settings. Style
rules remain active for B&W thumbnails, with their prompts and review criteria
interpreted in grayscale for that run. Saved styles stay unchanged. Rules pause
for other development studies and non-composition variation batches. A chosen
source guides subsequent variations; preservation is a request, not a pixel lock.

Attached images appear as larger previews above the prompt and as small numbered
image mentions within its prose. Clicking a preview inserts another mention at
the saved caret. Mentions store asset IDs; their visible numbers follow attachment
order. At submission they resolve to Image 1, Image 2, and so on, preserving the
surrounding prose. Missing attachments block submission until reattached or their
mentions removed. Legacy reference directions migrate once into visible editable
text; no hidden role instructions are appended. Runs freeze the resolved prompt,
while workspace run briefs retain stable mentions for revisions.

## Image annotations and protected edits

Annotate opens the existing image stage with red pen, arrow, box, and placed text
tools. Normalized coordinates survive resizing. Annotations are editorial
instructions in a transparent markup overlay, not image content. Erasing a note
removes it from the rendered instructions; no hidden duplicate text is sent.
Edit area remains a separate layer with deterministic protection outside its mask.
Protected requests also supply an unmasked original after all user references,
so the model can retain details hidden by the mask without renumbering inputs.

## Pinned images

Pinning bookmarks an asset independently of canvas selection, prompt attachment,
or Keep. A persistent board-local list opens in a right-hand drawer. Images can
be opened for refinement, located/restored on the canvas, downloaded, or unpinned.
The drawer remains open during canvas navigation; Escape returns to its trigger.
Removing a canvas image does not remove its pin or underlying asset.

## Submission feedback

The send control acknowledges locally while saves and planning are pending.
The typed prompt and linked blocks remain editable after submission. Batches
persist request IDs before dispatch, allowing an interrupted acknowledgement to
reuse IDs. An unchanged pending draft cannot be submitted again.


## Metaphor exploration

The floating composer owns brief entry, option reading and feedback. Sources and
options occupy the canvas as compact, movable objects. Connections indicate the
saved source of each option. Using an option as a prompt creates or locates the
standard editable prompt block. See [Metaphor composer](metaphor-composer.md).
