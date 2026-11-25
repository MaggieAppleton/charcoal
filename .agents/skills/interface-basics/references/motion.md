# State and motion

Start from the change being explained, its frequency and the user's next action. Preserve object identity, final values and focus first. The timings below are product adaptations of measured reference behavior, not a claim that Affect uses one universal motion scale.

## Working defaults

| Change | Starting treatment | Example and acceptance |
| --- | --- | --- |
| Subtle hover color/edge | About 120–160ms ease | A button's wash changes within its existing padded target; rapid exit remains direct |
| Small press | Subtle scale around .97, about 120–160ms | Glyph/label stay together; a large card receives much less displacement |
| Menu/disclosure enter and exit | About 180–240ms ease-out, anchored to trigger | Panel and arrow share origin/timing; closing retains the same spatial relationship |
| Larger pane/drawer | About 220–280ms, interruptible | Content stays readable; reversing during entry returns smoothly to the current origin |
| Keyboard point/option change | Immediate selection/focus | Arrows update the named value directly; panel opening/closing can still preserve spatial continuity |
| Frequent numeric/analysis refresh | Settled or very brief | Exact value and comparison are available immediately, independent of interpolation |
| Rare explanatory sequence | Separate deliberate timeline | Show cause before transfer/arrival/result, then allow the user to continue without waiting |

Map these treatments into host motion tokens. Use the same timing/ease for elements that move as one object. Separate phases can have distinct timing when their order explains causality.

## Change one persistent object

Example: a segmented choice moves one selected fill while labels keep their weight and width. A spinner/check share one fixed slot. A card grows its body under the same header. A receipt preserves the identity of the object acted upon.

Acceptance: nearby context stays still unless its layout actually changes; interruption begins from the current visual state; no pending action leaves focus at the document body. The user can continue as soon as the new state is actionable.

For a content swap, keep one current copy and at most one leaving copy. The leaving copy is inert, hidden from accessibility and unable to intercept the pointer. Clip only during a deliberate size morph, then restore focus-ring/shadow room. Announce meaningful status from a stable owner.

Reference Blur Crossfade uses 420ms/10px blur, or 380ms/6px in its sample button. Treat that as an occasional expressive treatment; ordinary frequent labels can change directly. Width/height morphs incur layout work: keep their scope bounded and inspect performance instead of promising compositor-only behavior.

## Preserve state without motion

Still mode shows the final meaningful content immediately. Pending remains understandable through text/busy state even when the spinner, sweep or pulse stops. Reduced motion removes nonessential entrances, loops, transitions, smooth scrolling and delayed reading; CSS rules alone cannot cancel independent JavaScript work.

Example implementation contract:

```js
const preference = matchMedia('(prefers-reduced-motion: reduce)');
function applyMotionPreference() {
  if (preference.matches) {
    stopAnimationFrame();
    clearCycleTimers();
    showCurrentStateImmediately();
  } else {
    startOnlyIfVisibleAndUseful();
  }
}
preference.addEventListener('change', applyMotionPreference);
applyMotionPreference();
// On component disposal: remove this listener and cancel its work.
```

These functions represent the host component's operations, not an installable helper. CSS also removes the corresponding local animation/transition rules. An app-level Still setting should follow the same path.

Acceptance: enabling reduced motion during an active animation stops it and exposes the correct state; pending/completion/error remain understandable. Returning to full motion does not replay stale work or duplicate timers. Include a still-mode fixture when OS emulation is unavailable, while recording that distinction.

## Pause decoration offscreen

Use a separate visibility observer for continuous playback. An observer that disconnects after first reveal cannot also pause future offscreen work. Cancel or suspend JavaScript loops, timers and CSS playback as appropriate; resume from a sensible state without a burst of queued events.

Example: a marquee pauses for keyboard focus independently of its hover preference; repeated copies are hidden/inert. Small sets can simply remain static. Persistent autoplay needs a discoverable pause/static route when appropriate to the experience.

Acceptance: offscreen and still-mode checks inspect the actual scheduler/playback state, not merely a class name or media-query block. Decorative input/autotyping events never trigger real submission or operational callbacks.

## Budget the whole sequence

For a staggered sentence, total time is delay + (pieces−1)×stagger + per-piece duration. Text Reveal's seven words at 40ms stagger/700ms each take 940ms to finish. Preserve real selectable/semantic text while hiding duplicate animated pieces; segment characters by grapheme where needed.

Example: a short introductory sentence may reveal once; a settings explanation appears immediately. Keep a full final numeric value separate from rolling digit stacks. Tabular figures stabilize equal-length values, not arbitrary digit-count changes.

Acceptance: all necessary reading and exact numbers are available without waiting for decorative interpolation. No type or control inherits miniature artboard scaling.

## Adapt the reference deliberately

| Before | After |
| --- | --- |
| 480–520ms button label/icon morphs, 900–1100ms chart entrances | Reserve expressive arrivals for rare use; frequent updates stay direct |
| CSS reduced-motion rules while a sampled-once JavaScript loop keeps running | Subscribe live, cancel work and settle the current state |
| Grid's one-time reveal observer treated as playback suspension | A separate visibility policy pauses ongoing drift |
| Shadow/background-position animation described as transform-only | Profile the actual properties and backdrop; simplify where needed |
| Timed “Sent”, “Copied” or “Exported” feedback | Resolve pending/success/failure from the host operation, preserving draft/retry context |
| Hover-driven expansion or a tilt on every working card | Subtle passing feedback; explicit disclosure and stable reading surfaces |

## Evidence

[Button](https://www.affectui.com/components/button), [Segmented Control](https://www.affectui.com/components/segmented-control), [Tool Call Card](https://www.affectui.com/components/tool-call-card), [Blur Crossfade](https://www.affectui.com/motion/blur-crossfade), [Number Ticker](https://www.affectui.com/motion/number-ticker), [Text Reveal](https://www.affectui.com/motion/text-reveal), [Gradient Floor](https://www.affectui.com/motion/gradient-floor), [Grid Background](https://www.affectui.com/motion/grid-background). These support construction/state lessons; live source-library reduced-motion behavior remains explicitly unverified in the detailed archive.
