# Charcoal

Proposed design for a browser tool that develops and applies editorial illustration styles. The first release assumes one person working on one Mac, with a browser front end and a local service. The review mockups use sample art and sample check results. The current design direction uses Maggie’s Interface Basics and Maggie Design rules for control sizing, icon alignment, readable type, and progressive disclosure.

## What existing tools do

| Reference | Pattern to carry into the design |
| --- | --- |
| Twombly | Use a freeform board for collecting and comparing material. |
| Studia | Use a quiet board with clusters of related outputs, a separate references drawer, and a selected image matched to a numbered prompt chip. |
| Adobe Firefly Boards | Sample images directly from the board and name their roles, such as composition or style. Put results on the board automatically, beside the inputs or source. [Firefly Boards workflow](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/create-boards.html) |
| Figma Weave | Paint a mask on the selected layer, enter an edit prompt, and receive the inpainted result on a new layer. Its node view also makes intermediate inputs traceable. Carry that traceability into the run record. [Weave Compositor](https://help.weavy.ai/en/articles/15887786-compositor-node) · [Weave nodes](https://help.weavy.ai/en/articles/12292386-understanding-nodes) |
| Krea Edit | Move from a generated image straight into a region-editing tool, with the work centered on the affected image. [Krea Edit](https://www.krea.ai/blog/krea-edit) |

## Workspace layout

Open directly onto the canvas. Keep related variations at comparable scales, with a text input available along the bottom. Selecting an image attaches it to the prompt and shows its thumbnail. Deselecting it removes the attachment. Bring up image-specific tools beside the selected image. Reveal run settings and style controls from the prompt area. The reference library opens on demand and closes back to the same board position. Keep a larger space available for editing rules and reviewing results.

A library collects possible inputs. A run sends only the materials in its ordered input list. This makes it possible to keep a large reference collection open while knowing which images Sunburst actually receives.

## Features and behavior

- **Board.** Import batches by drop, paste, or file picker. Place the batch near the drop point. Pan, zoom, marquee-select, shift-select, move, resize, undo, and add notes. Draw with a pen, eraser, arrows and simple shapes. Send a chosen sketch or group as a flattened reference. Keep the original strokes editable.
- **Prompt.** Keep a writable prompt on the board. Selecting images adds removable thumbnails to the prompt in request order. Describe how to use each reference in the prompt when it matters. A regional edit explicitly identifies the image it will edit. Support eight image inputs per run, including an edit target and any style references sent to Sunburst. Report any excess before sending and let the user choose which inputs to remove. Expose complexity, rendering quality, size and result count. Sunburst 2.6 is the proposed fixed image model.
- **Edit.** Select a target explicitly. For Mask, paint and erase any freeform editable area directly on the image. Use a brush cursor, adjustable size, an overlay of the accumulated strokes, and undo and preview controls. For Markup, draw a circle, arrow or replacement sketch over the image. Whole image handles global changes. Keep guides editable and attached to the selected image. Save each output as a separate candidate with a link to its source.
- **Style.** Create named styles with plain-text rules, attachments and version history. Each rule has an editable title and text, an enabled toggle, and a type. Show a compact rule list first. Opening a rule reveals its editable text, type, examples, and enabled state near one another. **Prompt instructions** add visible text to each run using that style. **Image checks** define what to inspect after each run and what counts as a pass. A rule can have both parts. Attach a positive example, a near miss, or a focal area when it clarifies a check. Show what is enabled and its source. Let the user override rules for a run. Show the exact outgoing image prompt before submission and the reviewer instructions in the run record, including any app defaults. Editing a rule creates a new style version; past runs still show the version used.
- **Review.** Place all candidates on the board. Compare source and output, including at the target site's thumbnail crop. Show each check as Passed, Failed or Needs review, with a short observation and optional location. Let the user override a judgment and record why. Approve, branch from any saved candidate, or turn a failed check into an editable proposed revision. In the first release, every revision is explicitly submitted. A failed or unavailable check stays visible and can be rerun independently of generation.
- **History and recovery.** Restore boards, styles, masks, run settings and results on refresh. Show pending and failed jobs beside their intended location. Provide export for the original candidate files and a project bundle. Record provider usage when returned and identify estimates as estimates. A retry of an uncertain paid request requires an explicit decision in the UI.

## Architecture choices

| Option | Where state lives | Tradeoff |
| --- | --- | --- |
| **Standalone app with a canvas SDK. Recommended.** React/TypeScript browser UI, a tldraw SDK adapter for spatial editing, and a local Node service for files, runs and OpenAI. | SDK document snapshot in local storage managed by the service. Image bytes on disk. SQLite records for images, guide revisions, style versions, runs and reviews. | Reuse image placement, navigation, drawing, selection and undo. Verify the tldraw license for the intended use before choosing it. Keep app data independent of the SDK so the canvas engine can be replaced. [tldraw assets](https://tldraw.dev/docs/assets) · [Persistence](https://tldraw.dev/docs/persistence) · [SDK license](https://tldraw.dev/sdk-features/license-key) |
| **Extend Twombly.** Add the composer and edit overlay to its existing board, with a companion job service. | Twombly owns board state, companion service owns files, versions and runs. | Reuses a familiar canvas. Need to verify whether an extension can access selection, image coordinates, editable guides and durable output placement. Otherwise the app would need to carry a fork. |
| **Build a custom canvas.** Use React with a lower-level pointer and rendering layer. | App owns camera, input, spatial state and persistence alongside image and run data. | Gives full control over interactions and licensing choices. Adds work for selection, transforms, keyboard behavior, undo, assets and large-board performance. |

Run this as a standalone local tool. Keep secrets in the local service environment. The browser never receives an API key. Use a packaged loopback server in the first release, with SQLite and an image directory as the durable project. Keep the image API adapter and visual reviewer behind independent interfaces.

## Request and pixel behavior

1. Freeze a run before sending it. Save the ordered input versions, final prompt, enabled checks, settings, guide, and parent image. A remote call runs independently of the board view. Use stable run/output IDs to avoid duplicate tiles on refresh. A process interruption leaves an explicit recoverable status.
2. Use `POST /v1/images/generations` for text-only prompts. Use `POST /v1/images/edits` when the run has image inputs, including reference-based creation. OpenAI documents up to 16 edit inputs. The proposed UI cap is eight. The edit target always goes first when present. [Images API](https://developers.openai.com/api/reference/resources/images/methods/edit) · [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
3. Normalize input orientation once and map pointer strokes from board coordinates back to source pixels. If the source size is unsupported, fit it into a supported request canvas with recorded padding and a reversible coordinate transform. Use the same transform for the guide. For Mask, export a target-sized PNG whose editable pixels have alpha zero. For Markup, export a target-sized transparent PNG carrying the painted marks. Send one guide mode per request. The model guide explicitly covers markup for Sunburst 2.6. Confirm both Sunburst operations against the actual endpoint and SDK version in the first live integration check. [Mask guide](https://developers.openai.com/api/docs/guides/image-generation#edit-an-image-using-a-mask) · [Markup guide](https://developers.openai.com/api/docs/guides/image-generation#guide-an-edit-with-markup)
4. **Edit area** uses the paint as a guide to a local change. Send a binary provider mask over an expanded neighborhood and include an unmasked source reference. Map the generated image back to the normalized source grid and feather the blend by distance from the surviving paint. Compare decoded RGBA with the source wherever the blend reaches zero. Reject unalignable returns with a recoverable message. Masked variations explore the requested local change. Markup guides wider revisions.
5. Record raw output separately from the blended candidate. Run optional visual checks on the candidate the user sees, with reference crops and the rule snapshot. Compare the image at full size and thumbnail size where a rule calls for both. A visual judgment can abstain. Exact pixel checks run in code.

## Build slices for the implementation run

1. **Board and storage.** Drop a folder of references, arrange them, sketch, reload and recover the board.
2. **Sunburst and run records.** Generate with zero and up to eight inputs, inspect request details, and see candidates on the board. Cover invalid inputs, failures and refresh during a job.
3. **Mask and markup.** Paint on the selected target at different pan and zoom levels, send the corresponding request, compare candidates and verify a smooth transition with exact pixel preservation beyond the blend.
4. **Style rules.** Edit instructions and checks, version a style, preview the effective prompt, and prove that old runs still show their original version.
5. **Review and export.** Show per-rule evidence, let the user override or revise, compare source and candidate, and export an approved asset or project bundle.

## Decisions to review

- Is it clear which images will be sent when you select them, and where to edit an attached style without leaving the canvas?
- Should “Approve” allow a manual override of a failed check with a note? The mockup shows review information and an approval action together. Make the override explicit if approval is allowed.
- Is one user on one machine the right first-release boundary? Shared boards would change persistence, credentials, job ownership and asset storage.
