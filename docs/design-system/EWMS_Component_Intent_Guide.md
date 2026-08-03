# EWMS Component Intent Guide

This document answers a question Figma's component structure alone cannot answer: **which configuration of a component's properties is correct for a given page or context?** MCP access to the Figma file tells an agent what a component CAN do (its variants, booleans, instance-swap slots). This document tells the agent what it SHOULD do, in a specific place, and why.

**How to use this document (for the agent):**
1. Before configuring any component pulled from the Figma MCP connection, check this guide for an entry matching the current page/context.
2. If an entry exists, follow it exactly — do not deviate based on what "looks right" in isolation.
3. If no entry exists for this exact case, do not guess a configuration. Flag it and ask, the same way you'd flag a missing token rather than inventing one.
4. This document grows over time — every time a new page or component reaches a settled usage decision, add an entry here rather than leaving it to be re-decided ad hoc in a future session.
5. Component states (hover, focus, error, disabled) are generally automatic once a component is correctly built with bound variants in Figma — an MCP-aware agent should read and apply these directly without needing re-explanation. What this document covers is different: judgment calls about WHICH configuration/variant applies in WHICH context, which Figma's structure cannot express on its own.

This is a companion to the main Rulebook (`EWMS-Frontend-UIUX-Rulebook-v2.md`), not a replacement — token names, typography, RBAC, and infrastructure rules live there. This document is purely: component → context → exact configuration → why.

---

## KPI Card

**Dashboard page**: Has icon = true, Has sub-metrics = true, Sub-metric count = two, Has trend = false.
- Exception: **D&D Exposure** specifically uses Sub-metric count = one (it only has one supporting figure, not two).
- Icon and trend are mutually exclusive — never combine on the same instance. Icon wins at dashboard level, since dashboard is overview/scanning mode.

**Any other page** (detail views, module-specific pages, drill-downs): Has icon = false, Has sub-metrics = false, Has trend = true only if trend-over-time is relevant to that specific page's context, otherwise false. Label + main metric only — this is focused/detail mode, not overview mode.

**Why**: dashboard KPIs need to communicate composition (a metric plus its supporting breakdown) at a glance across many cards; detail-page KPIs sit next to the actual record they describe, so the breakdown is redundant — the surrounding page already provides that context.

**Icon assignment (locked)**: each KPI's icon reuses the same icon as its corresponding sidebar module (Rulebook Section 19's locked sidebar mapping) — Shipment Summary → `Ship`, Task Summary → `ClipboardList`, Inventory Summary → `Boxes`, D&D Exposure → `icon/dollar-sign`, Budget Monitoring → `Receipt`/`DollarSign` (same as Accounting). Delivery Summary uses the closest available delivery-related icon if/when the module splits distinctly from Shipments. One consistent icon language across sidebar and KPI Card — not a separate icon set per metric.

---

## Badge / Status Indicator

**Every usage**: route the raw status string through the Status → Intent mapping before assigning a Badge intent — never assign a color or intent directly to a status string in code.

Current mapping (colors confirmed in Figma):
- Draft, Re-trigger Generation → `draft` (gray)
- Pending Approval, Pending Revalidation, Pending Review, In Review, Hold/Resume → `warning` (amber)
- OCR Processing, Validation In Progress, Confirmed Out → `info` (blue)
- Approved, Validated, Validated (Override), Mapped, Delivered, Completed → `success` (green)
- Active, Uploaded, Extracted, Amended, Generated, Reserved, Returned → `success` (green) — same bucket as above
- Rejected, Discarded, Dispatch Rejected, Validation Blocked, Validation Warning → `danger` (red)
- Blocked, Validation Blocked → `danger` (red)

**Important distinction**: `badge/bg/active` / `badge/text/active` use Zet Teal, NOT green — this is a SEPARATE intent from `success`, reserved for a currently-active/in-progress state that is visually distinct from a completed/success state. Do not conflate "Active" status with "Success" status even though both are in the green/teal family — check which one actually applies before assigning.

**No parallel pattern**: Badge is the single standard for all status representation app-wide. Do not build or use a "Status Text" pattern anywhere — this was explicitly rejected.

---

## Progress Bar

**Any usage**: only two true variant axes — Intent (7 values, reusing Badge's intent tokens) and Value display (percentage / ratio / none). Has label, Has segmented fill, Secondary intent, and Size are properties layered on top, not separate variants — do not treat them as requiring their own variant combination.

**Segmented fill**: use when a single bar needs to show two states in one track (e.g. Gate Health's teal-active + red-blocked in the same bar) — this requires Has segmented fill = true with a Secondary intent set, rather than trying to represent it with two overlapping bars.

**Gate Health specifically**: uses Progress Bar's underlying pattern conceptually but is now its own dedicated Gate Health Card component (see below) — Gate Health's Active/Blocked columns are plain numeric values, not a Progress Bar instance. The horizontal-bars-over-radial decision from earlier sessions still stands as the general principle: bars are the correct choice for "spot the bottleneck" comparison tasks wherever that pattern applies elsewhere.

---

## Gate Health Card

**Dashboard page only**: sits directly below the KPI Card row. One card per gate, repeated horizontally (5 gates confirmed in current dashboard layout).

**Card treatment — deliberately different from KPI Card despite matching padding**: uses the SAME padding as KPI Card, but has NO shadow and NO hover state — this is a static summary display, not an interactive element, so it should read as slightly quieter/flatter than KPI Card even though the spacing rhythm matches.

**Body rows**: currently defaults to exactly 2 rows (Container icon, Break-bulk icon) for this client — built as a flexible/repeatable structure, not a hard 2-row cap, specifically so a future client's gate configuration could show a 3rd cargo type without requiring a rebuild. Do not assume 2 is a permanent limit when configuring for a new client.

**Numeric color rule**: Active count always renders in success-green; Blocked count always renders in danger-red — even when Blocked = 0. Do not neutralize the 0 value to a muted/gray treatment; the red is intentional so a scanning eye can immediately confirm "confirmed zero blocked" rather than "not applicable."

**Icon color**: neutral/muted gray, not status-colored — the icons identify cargo type only, all status communication lives in the numbers.

---

## Step Node / Stepper Horizontal / Stepper Vertical

**Connector color rule (applies everywhere, no exceptions)**: a connector segment's color is determined by the node it is ARRIVING AT, not the node it departs. Arriving at Completed/Active → green. Arriving at Hold → amber. Arriving at Cancelled → red. Arriving at Upcoming/Overdue → neutral. This must be a bound relationship per Step Node, never manually colored per instance.

**Stepper Horizontal**: capped at 7 steps maximum, via fixed slots + "Has step N" visibility booleans (steps 1–2 always visible as the minimum). Each step's Status (Completed/Active/Hold/Cancelled/Upcoming/Overdue) is exposed as an independently settable property at the TOP-LEVEL component panel — this was missed in earlier builds (buried in nested Step Node layers) and has since been rebuilt and confirmed: selecting an instance shows Step 1–7 Status directly in the properties panel, not buried in layers.

**Stepper Vertical**: NOT a capped shell — a single repeatable Step Row that the page stacks vertically as many times as needed, with connectors chaining automatically. Do not add a "step count" property to this component; flexibility comes from stacking instances, not a property.

**Active vs. Completed visual distinction**: both share the same green color, but must be structurally different — Completed is a solid filled circle, Active is a ring/outline treatment (with an inner dot or pulse). Never rely on position-in-sequence alone to distinguish them; the shapes themselves must differ.

**When to use Stepper Horizontal vs. Gate Indicator vs. Stepper Vertical vs. Gate Health Card**:
- **Stepper Horizontal**: compact inline progress in space-constrained contexts (e.g. a shipment's ETA summary bar), up to 7 labeled or unlabeled steps.
- **Gate Indicator**: dense list-row contexts specifically (e.g. inside List Cell's Gates column), fixed at exactly 5 gates, only 2 states (Completed/Yet) — do not use the full Stepper family here, it's visually too heavy for list density.
- **Stepper Vertical**: detailed timeline views (e.g. Inventory Journey milestone tracker) where each step carries richer content (tags, dates, overdue messages) — unlimited length.
- **Gate Health Card**: dashboard-level summary of gate activity by cargo type — a distinct component, not part of the Stepper family at all, do not confuse with Gate Indicator.

---

## Table atoms (Header Cell, Data Cell, Total Cell)

**Data Cell Type selection — this is the core judgment call, always choose based on what the value actually IS:**
- **Auto-populated**: any value extracted directly from a source document with no computation — plain text, regular weight, standard text color.
- **Auto-calculated**: any value that is the result of a formula/computation (SUM, derived totals) — SAME color as Auto-populated, but BOLD weight. Never give calculated values a distinct color; bold alone is the signal (matches checkout/calculator UI conventions — a computed result gets emphasis via weight, not a "this is special" color that implies clickability).
- **Input**: any value the user must manually type — border-only styling (teal at rest via `input/border/focus`, red on error via `input/border/error`), never a background fill change, uniform fixed width within a column regardless of typed content length.

**Alignment**: Numeric content is ALWAYS right-aligned, across all three Data Cell types — Auto-populated, Auto-calculated, and Input alike. Text content is always left-aligned. This is not a per-instance choice; it's bound to the cell's Content type property.

**Header row**: needs a subtle background fill of its own (distinct from body rows) to structurally separate header from data — font-weight alone is not sufficient separation.

---

## List Cell / List Row / List Header Row (v2 architecture)

**Do not use the older fixed "List Item" component** for any new list-view work — it is deprecated in favor of the v2 architecture below (kept in parallel only until v2 is fully verified across real use cases).

**Content type selection per List Cell slot — choose based on what's actually being displayed, not by habit:**
- **Stacked-text**: an ID/name + a sub-label underneath (e.g. Shipment ID + BOL number, or Project ID + client name).
- **Badge**: any status representation — single or, when two statuses genuinely coexist (e.g. "Pending QC" + "SLA overdue"), stacked double-Badge.
- **Progress**: any completion-percentage or ratio value that benefits from a visual bar, not just a number.
- **Gate indicator**: specifically the 5-gate compact view — use this, not Stepper, for list-row density (see Stepper section above).
- **Stepper (labeled)**: use only when the row genuinely needs the fuller labeled step view (e.g. container tracking's full stage list) — heavier than Gate indicator, so don't default to this if Gate indicator would do.
- **Metric**: right-aligned numbers/currency, with colored text (danger red) reserved specifically for overdue/negative values — not for general emphasis.
- **Date**: plain, optionally stacked with a status sub-line (e.g. "Apr 22" / "On Time").
- **Action**: only when the row itself needs an inline actionable button (e.g. "Review →") — most rows should rely on row-level click/hover instead of an explicit button.
- **Chevron**: static display affordance only — the row itself is the click target, the chevron is not independently interactive.

**Which columns for which list type** (confirmed real examples — use as direct precedent when building a new list page, don't re-derive column composition from scratch):
- **Shipments-style**: Stacked-text (Shipment/BOL), Stacked-text (Vessel/Route), Metric (Project ID), Badge+Gate-indicator combo (Stage/Phase), Metric (Load/Incoterm), Progress (Documents), Date+Badge (ETA/status), Metric (Alerts).
- **Documents-style**: Icon tile (doc type), Stacked-text (doc type label + source doc), Stacked-text (Shipment link), Badge (status), Date (created), Action (Review button).
- **Container-tracking-style**: Stacked-text (Container/Shipment), Stepper-labeled (full stage progress), Stacked-text (Vessel/ETA), Metric+Badge (LFD/D&D dollar amount + status), Chevron.
- **Projects-style**: Stacked-text (Project ID + client), Badge (status), Progress (shipment completion), Metric ("N active" count), Date, Chevron.

---

## Segmented Control

**Sizing rule**: every tab in a given control instance renders at the SAME width, sized dynamically to match whichever label is LONGEST in that specific instance — not a fixed worst-case width applied to every control regardless of actual content. A short-label control (e.g. "All / Active / Done") should size tightly to "Active," not reserve space for a hypothetical 18-character label. 18 characters is the supported per-label MAXIMUM (no truncation ever occurs), not the default reserved width.

**Segment count**: 2 minimum, 8 maximum, via fixed slots + visibility booleans, same pattern as Stepper Horizontal.

**Usage in Modal Shell**: when a modal needs to switch between related source documents (e.g. Packing List / Shipping Bill / Draft Bill of Entry), use Segmented Control in the modal header — do not build custom tab UI inline.

---

## Toggle Switch vs. Checkbox vs. Radio Button (when to use which — carried from Rulebook Section 10, restated here with the "why")

- **Toggle Switch**: module/feature on-off settings — a single, immediate, binary state change (e.g. enabling a module in admin settings).
- **Checkbox**: true multi-select only (e.g. selecting multiple rows for a bulk action) — never use for a single on/off setting, that's Toggle's job.
- **Radio Button**: mutually exclusive single-select from a visible set of named options (e.g. role level selection) — never allow multi-select when the underlying business rule is single-select.

**Why this matters**: these three controls are visually similar enough (all small, all binary-ish) that misusing one for another's job creates a subtle but real usability mismatch — a Toggle used for a multi-select list, or Checkboxes used for a single mutually-exclusive choice, both violate the user's mental model of what the control implies about the underlying data.

---

## Date Range Picker (Trigger + Calendar Panel + Day Cell)

**Static reference only**: this component family is a visual reference in Figma — live date math, month navigation, and actual range-selection interaction are implemented in code, not simulated in Figma. Do not expect the Figma version to demonstrate real interactivity; use it only to confirm visual states (Empty/Filled/Focus on the Trigger; Range-start/middle/end/Today/Disabled on Day Cell; Open composition showing Trigger + Calendar Panel together).

**Trigger button state behavior**: Preset-label state (e.g. "YTD") is the default/closed appearance; Range-filled state (showing the literal selected dates) only appears after a user completes a selection via the Calendar Panel and confirms; Open state is the documented composition of Trigger + Calendar Panel together (not a live interactive state in Figma) — these are all the same component's State variant, not separate components.

---

## Overflow Menu (Trigger + Panel + Menu Item)

**Trigger**: this is the existing Button component in Icon-only mode with `icon/more-vertical` — not a separate "Overflow Button" component. Same rule applies to Close (`icon/x`) and Back (`icon/chevron-left`) — all icon-only chrome controls are Button variants, never separate components.

**Panel body**: flexible-count Menu Item stack, not a fixed-slot shell — a panel might hold 2 items or 6 depending on context, composed per usage the same way Stepper Vertical's rows are composed.

**Destructive items** (e.g. "Delete"): use Has destructive style = true, binding text/icon to `Colour/Status/Danger` — and pair with a "Has divider after" on the item before it, to visually separate destructive actions from routine ones (Duplicate/Rename vs. Delete, for example).

---

## Accordion

**Status property is a 4-value tint, not a boolean**: Neutral (default surface bg) / Attention (danger tint) / Success (success tint) / Warning (warning tint) — chosen based on whether the section's content currently needs the user's attention, not just an on/off "highlighted" state.

**Body is a free content slot**: do not expect or build structured properties for what goes inside an open Accordion — every instance's content differs (form fields, tables, line items). This is intentional, matching the same philosophy as List Row's flexible composition and Modal Shell's free-content body.

**Usage inside Modal Shell**: Modal Shell's free-content body frequently holds stacked Accordion instances for multi-section forms (e.g. Header / Parties / Shipping / Line Items / Totals / Signatory, as seen in the Packing List reference) — this is the expected composition pattern, not a coincidence.

---

## Modal Shell vs. Warning/Action Modal

- **Modal Shell**: create/edit workflows, multi-section forms, anything needing custom body content — free-content body frame, header supports Segmented Control for related-document switching, footer supports progress display + multiple actions. Centered, backdrop blur, grows with content up to a max height/width cap, scrolls internally beyond that.
- **Warning/Action Modal**: simple confirmations and destructive-action warnings only — fixed, compact layout, no free-content body, must be able to display the specific entity being affected (e.g. "Delete shipment ZTW-2025-0422?", never a generic "Are you sure?").

Do not use Warning/Action Modal for anything requiring custom form fields or multi-section content — that forces content into a shell that wasn't designed to hold it. Do not use Modal Shell for a simple yes/no confirmation — that's over-building a case that has a simpler, more predictable pattern available.

**Status**: both components are built and confirmed as true Figma components.

---

## Doc Viewer

**Document area is a placeholder**: the actual rendered document display is a code-level concern, not solved in Figma — the Figma component only defines the bounding frame, border, and control bar around it.

**Control bar**: floating, bottom-center, pill-shaped, containing zoom-out / zoom-percentage / zoom-in / fullscreen-expand — this is a fixed, small set of controls, do not add additional controls to this bar without a specific need (e.g. rotate, download) being identified first.

**Multi-document tabs**: when a record has multiple source documents (e.g. Packing List vs. MTR), use Segmented Control above the Doc Viewer frame — same reuse rule as everywhere else, do not build custom tabs.

**Status**: built and confirmed as a true Figma component.

---

## Open items (component decisions still pending — do not guess these)

This guide has no remaining open items requiring confirmation.
