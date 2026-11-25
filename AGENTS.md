# Charcoal

Charcoal is a standalone browser app for editorial illustration. Follow `BUILD.md` for the implementation sequence and completion checks.

## Approved interface

[design/approved-mockup.html](design/approved-mockup.html) is the visual and interaction specification. Maggie approved this exact Claude Opus 5.5 mockup. Preserve the layout, spacing, sizes, icons, typography, color, artwork presentation, interface copy, surface hierarchy, and disclosures. The test state switcher above the frame belongs to the mockup. Any interaction missing a production state should extend the approved components and their grammar. Treat earlier layout proposals in the product plan as superseded wherever they differ.

Before working on UI, read both bundled skills and the applicable references. Give every UI implementer and reviewer these exact paths and access to the mockup.

- [.agents/skills/interface-basics/SKILL.md](.agents/skills/interface-basics/SKILL.md)
- [.agents/skills/maggie-design/SKILL.md](.agents/skills/maggie-design/SKILL.md)

## Work and verification

Keep changes small and reviewable. Preserve lockfiles and pin the runtime and dependencies. Verify the intended canvas SDK license before adopting it. Keep provider credentials server-side. Local Git commits are the handoff. External publication requires explicit user authorization.
