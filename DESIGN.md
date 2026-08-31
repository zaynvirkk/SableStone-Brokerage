---
name: SableStone Brokerage
description: A receipt-backed industrial brokerage register for protected polymer trades.
colors:
  carbon-blue: "#164b73"
  carbon-blue-deep: "#0d314d"
  paper: "#f4f0e6"
  paper-inset: "#ebe5d7"
  graphite: "#202522"
  rule: "#b8b4a8"
  safety-amber: "#d69b20"
  stop-red: "#a33a2e"
  pass-green: "#2d6951"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 4vw, 3.1rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.055em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "0.69rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.08em"
rounded:
  docket: "2px"
spacing:
  compact: "8px"
  register: "16px"
  sheet: "18px"
components:
  button-primary:
    backgroundColor: "{colors.carbon-blue}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.docket}"
    padding: "14px 16px"
  status-pass:
    textColor: "{colors.pass-green}"
    typography: "{typography.label}"
    rounded: "{rounded.docket}"
    padding: "3px 6px"
---

# Design System: SableStone Brokerage

## Overview

**Creative North Star: "The Dispatch Docket"**

SableStone reads like an Indian industrial weighbridge register translated into software: paper-white working surfaces, carbon-blue rules, graphite entries, safety-amber warnings and rectangular decision stamps. Its density signals evidence and control, while clear state color and generous section breaks prevent the register from becoming a spreadsheet.

The world is operational, not nostalgic. Physical cues come from rules, perforation-like divisions and accounting layout; it does not imitate distressed paper, ink bleed, bevels or other fake material effects.

**Key Characteristics:**

- Continuous transaction sheets instead of floating dashboard cards.
- Mono evidence labels paired with compact, high-weight sans-serif headings.
- Identity, fee and provider states are visible at the point of decision.
- Synthetic and unavailable conditions are stated directly.

## Colors

Carbon blue anchors navigation and evidence rules; paper neutrals carry the working surface; amber, red and green appear only as state semantics.

**The State Ink Rule.** Amber means unresolved, red means stopped and green means proven pass; never use those colors as decoration.

## Typography

**Display Font:** Inter with the system sans-serif fallback stack  
**Body Font:** Inter with the system sans-serif fallback stack  
**Label/Mono Font:** SFMono-Regular with Consolas and Liberation Mono fallbacks

**Character:** Headings are compressed, heavy and direct. Evidence labels are compact mono entries that evoke a printed register without reducing body-copy readability.

**The Two-Hand Rule.** Sans-serif explains; mono records. Do not set long explanatory passages in mono.

## Layout

Desktop product surfaces use a fixed 13.5rem register navigation and a fluid docket. The primary workbench splits transaction evidence from a narrower deterministic-decision strip. At 820px, navigation becomes a horizontal register and every split sheet stacks. At 480px, key/value rows reflow without hiding state.

Spacing follows an 8px compact rhythm with 16–18px sheet insets. A screen may scroll vertically but must remain within a 320px viewport without horizontal page overflow.

## Elevation & Depth

There are no shadows. Depth comes from paper-tone changes, one-pixel rules, double docket rules and adjacent ledger surfaces.

**The Flat Register Rule.** A new layer earns separation through rule and tone, never through a floating shadow.

## Shapes

Corners are square or nearly square. Buttons and status stamps use a 2px docket radius; sheets stay rectangular. Double borders belong to document boundaries and deterministic decision strips.

## Components

### Buttons

Primary buttons use carbon blue, white mono labels and a 2px radius. Disabled actions retain a visible border, explain the missing prerequisite nearby and never look executable. Keyboard focus is a three-pixel safety-amber outline.

### Cards / Containers

The system uses continuous sheets rather than freestanding cards. Sheets have paper-tone fills, precise rules and 18px internal padding; they never use shadows.

### Inputs / Fields

Fieldsets use a one-pixel rule and explicit legends. Native radio controls remain recognizable. Focus uses the shared safety-amber outline.

### Navigation

The desktop register is carbon-blue and persistent. Its active entry gains amber text and a small square register mark. Mobile navigation scrolls horizontally without changing route order.

### Status Stamp

Status stamps are outlined mono labels. Their word and color must agree, and unknown must never be rendered as pass.

## Do's and Don'ts

### Do:

- **Do** keep synthetic fixtures, sealed identity and unavailable provider states visible.
- **Do** use rules and ledger alignment to express hierarchy.
- **Do** keep every actionable control at least 44px high.

### Don't:

- **Don't** convert the register into a metric-card dashboard.
- **Don't** introduce gradients, glass, drop shadows or decorative state colors.
- **Don't** imply provider approval, funding, settlement, inventory or revenue without a current receipt.

