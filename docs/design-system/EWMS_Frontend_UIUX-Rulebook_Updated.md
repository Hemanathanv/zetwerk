# EWMS Frontend and UI/UX Rule Book (v2)

This rule book is the source of truth for building and reviewing EWMS frontend work. It applies to all React pages, shared components, admin screens, partner/customer portals, upload flows, and future modules. Token, typography, and layout sections reflect the actual Figma design system (Primitives → Semantics → Components, 3-tier architecture) so that Figma and code stay in lockstep.

---

## 1. Product Principles

EWMS is an operational logistics system. The UI must feel fast, controlled, readable, and permission-aware.

Rules:
- Build the actual workflow first, not marketing-style screens.
- Optimize for repeated daily use by operations, finance, warehouse, partners, and admins.
- Prefer dense but calm layouts over decorative layouts.
- Every visible action must have a clear permission reason to exist.
- Every screen must answer: what is the user looking at, what needs attention, and what can they do next?
- Avoid visual noise. Use space, alignment, hierarchy, and status colors instead of decoration.
- **The experience must be uniform across every module.** Admin settings, partner portal, dashboard, and every operational page render through the same component library and the same rules in this document — no page is styled as a one-off "marketing" exception.

---

## 2. Frontend Stack Rules

Current stack:
- React with TypeScript.
- Vite.
- Wouter routing.
- TanStack Query for server state.
- Tailwind CSS plus app CSS variables from `frontend/src/index.css`.
- shadcn-style primitives in `frontend/src/components/ui`.
- Lucide icons.

Rules:
- Use existing shared components before creating new UI primitives.
- Put reusable admin patterns in `frontend/src/components/admin`.
- Put app-wide UI primitives in `frontend/src/components/ui`.
- Put business pages in `frontend/src/pages`.
- Keep API access through existing API helpers and auth-aware clients.
- Do not introduce a new state library unless there is a clear cross-app need.
- Do not bypass `PermissionContext` for module or activity access.

---

## 3. Design Tokens

Figma defines tokens in three tiers. Components must alias Semantics or Primitives — never a raw hex value, and never skip a tier.

**Primitives → Semantics → Components.** A component-level token like `badge/bg/success` aliases a Semantics token (`Colour/Status/Success bg`), which in turn aliases a Primitive (`Colours/Green/50`). When building or reviewing code, always resolve through this chain — never hardcode a hex value that happens to match a Primitive, since that breaks dark-mode switching and any future rebrand.

### Primitives (raw values — never reference directly in component code; always go through Semantics/Components)

Color families (each with a 50/100 or 200 through 900 ramp): `Colours/Zet Teal`, `Colours/Zet Blue`, `Colours/Zet Gold`, `Colours/Red`, `Colours/Green`, `Colours/Amber`, `Colours/Blue`, `Colours/Gray`, plus dedicated `Colours/Sidebar/700-900` (sidebar is permanently dark regardless of app theme).

Spacing scale: `Spacing/Sp-1` (4px) through `Spacing/Sp-16` (64px) — always bind spacing to this scale, never a manual pixel value.

Radius scale: `Radius/sm` (6px), `Radius/md` (8px), `Radius/lg` (12px), `Radius/xl` (16px), `Radius/2xl` (20px), `Radius/Full` (999px, pills/badges/avatars).

Font size scale: `font-size/xs` (11px) through `font-size/3xl` (38px).

### Semantics (Light + Dark modes — this is the layer app code should bind to for anything not covered by a Components token)

| Semantic token | Light | Dark | Usage |
|---|---|---|---|
| `Colour/Text/Primary` | `#090909` | `#FFFFFF` | Default body/heading text |
| `Colour/Text/Secondary` | `#555555` | `#C9C9C9` | Muted supporting text |
| `Colour/Text/Muted` | `#A5A5A5` | `#737373` | Placeholder, disabled text |
| `Colour/Text/On-accent` | `#FFFFFF` | `#FFFFFF` | Text on filled accent/primary buttons |
| `Colour/Text/accent` | → `Colour/Accent/Default` | → `Colour/Accent/Default` | Links, accent-colored text |
| `Colour/Surface/Page` | `#F5F5F5` | `#090909` | Page background |
| `Colour/Surface/Card` | `#FFFFFF` | `#1C1C1C` | Card/panel background |
| `Colour/Surface/Elevated` | `#FFFFFF` | `#353535` | Dropdown/modal/popover surfaces |
| `Colour/Border/Default` | `#E5E5E5` | `#353535` | Default dividers, input borders |
| `Colour/Border/Strong` | `#C9C9C9` | `#555555` | Emphasized borders (secondary button outline) |
| `Colour/Accent/Default` | `#2A9D90` (Zet Teal 500) | `#2A9D90` | Primary actions, focus states, selected states — teal, same value both modes |
| `Colour/Accent/Hover` | `#57B8AB` | `#83DDD0` | Hover state of accent elements |
| `Colour/Status/Success` | `#198653` | `#0F5835` | Success text/icon |
| `Colour/Status/Warning` | `#D17215` | `#6E3B0C` | Warning text/icon |
| `Colour/Status/Danger` | `#C51625` | `#EF4343` | Danger/error text/icon |
| `Colour/Status/Info` | `#0C46C3` | `#0D54A0` | Info text/icon |
| `Colour/Status/{Success,Warning,Danger,Info} bg` | light tints | dark-appropriate tints (Danger bg = `Red/600` solid in dark, others are light tints in both modes — confirmed intentional, not a bug) | Background washes for banners/alerts |

### Components (the layer most app code should actually bind to — aliases Semantics/Primitives, includes exact pixel/spacing values)

**Button:** `Button/radius` (8), `Button/height/{sm:28, default:32, lg:40}`, `Button/padding-x/Default` (16), `Button/padding-x/icon-only-{sm:6, default:8, lg:12}`, `Button/gap/For icon` (8). Variant backgrounds/text: primary (teal fill, white text), secondary (elevated/card bg, primary text), outline (transparent, strong border), ghost (transparent, primary text, hover = elevated bg), danger (red fill, white text), success (green fill, white text), disabled (gray fill, muted text).

**Badge:** `badge/radius` (999, full pill), `badge/gap` (4), `badge/padding-x/{default:10, sm:8}`, `badge/padding-y/{default:4, sm:2}`. Backgrounds are light tints (`badge/bg/success`, `/warning`, `/danger`, `/info`, `/active`, `/draft`, `/neutral`); text colors are the corresponding saturated Status color (`badge/text/success` = `Colour/Status/Success`, etc.). Note: `active` uses Zet Teal, not green — this is intentional (Active status ≠ Success status, even though both render close in hue; see Section 14 for the full status mapping).

**Input:** `input/height` (32), `input/padding-x` (16), `input/radius` (8), `input/stack-gap` (6), `input/label-gap` (2), `input/helper-gap` (4), `input/padding-y/textarea` (10), `input/gap/leading-icon` (8), `input/gap/trailing-icon` (8), `input/gap/label-to-field` (6). Borders: `input/border/default` → `Colour/Border/Default`, `input/border/focus` → `Colour/Accent/Default` (teal — this is the resting/active look for any table/list input cell, not just a hover-triggered state), `input/border/error` → `Colour/Status/Danger`. Input is border-only styling — no background fill differentiates states (background stays `input/bg/default` regardless of focus/error).

**List row:** `list-row/padding-y` (12), `list-row/gap` (12), `list-row/bg/hover` → `Colours/Gray/50` (light) / `Colours/Gray/Transparent` (dark, confirmed).

**Nav (sidebar — always dark regardless of app theme):** `nav/divider`, `nav/bg/hover`, `nav/bg/active` → `Colours/Sidebar/700-900` family. `nav/text/default` → `Colours/Gray/400`, `nav/text/hover` → white.

**Card:** `card/padding/compact` (16), `card/padding/Default` (24).

**Page/section spacing:** `page-section/gap` (28), `content-grid/gap` (24), `metric-grid/gap` (16).

**Modal/dropdown:** `modal-or-dropdown/radius` (16). Effect styles: `modal-or-dropdown/shadow` (2-layer standard), `modal-or-dropdown/KPI Shadow` (dramatic directional — flagged in Figma export as worth verifying it's intentional vs. a copy/paste artifact; treat as correct unless told otherwise), `modal-or-dropdown/List shadow` (single-layer, lighter).

**List column widths (fixed reference set for the Shipments-style list — reuse these values, do not invent new column widths ad hoc):** type (37–48px), status/shipment (260px), gates (96px), docs (40–48px), eta (60px), containers (40–88px), weight (75–80px), added (52–88px), col-gap (48px). Note the export shows two slightly different value sets (one in "Primitives" grouping at 0, one in "Components"/"List Columns" grouping with real values) — treat the non-zero "Components"/"List Columns" values as authoritative.

### Crosswalk: Figma token family → app CSS variable

This pairing is a codebase-specific decision — even with live Figma/MCP access, the agent still needs this table to know which app CSS variable a given Figma token maps to.

| Figma token family | App CSS variable | Notes |
|---|---|---|
| `Colour/Border/Default` | `hsl(var(--border))` | |
| `Colour/Accent/Default` | `hsl(var(--primary))` | Teal — focus, selected, primary actions |
| `Colour/Status/Danger` | `hsl(var(--destructive))` | |
| `badge/bg/success`, `badge/text/success` | `hsl(var(--vs-success))` | |
| `badge/bg/warning`, `badge/text/warning` | `hsl(var(--vs-warning))` | |
| `badge/bg/danger`, `badge/text/danger` | `hsl(var(--destructive))` | |
| `badge/bg/info`, `badge/text/info` | `hsl(var(--vs-info))` | |
| `Colour/Text/Primary` | `hsl(var(--foreground))` | |
| `Colour/Text/Secondary` | `hsl(var(--muted-foreground))` | |
| Card surface | `hsl(var(--card))` | |
| Neutral/muted surface | `hsl(var(--muted))` | Header row fill, disabled fills |

**Rule:** if a component's Figma spec references a token not in this table, do not invent a matching value — flag it and confirm against the live Figma file before shipping. If a Figma token is encountered with no corresponding CSS variable in the crosswalk, do not invent one on the fly — add the pairing here once resolved.

---

## 4. Typography

Inter is used throughout, including for numerics and mono-style data, using `tabular-nums` (tnum) and `ss01` (slashed zero) OpenType features rather than a separate monospace font. IBM Plex Mono remains an optional future consideration only for very dense ledger-style tables — not yet implemented, do not add without an explicit decision to do so.

### Text styles (21 total, all Inter)

**Display:**
- `display/page-title` — 38px, 600, LH 120%, LS -2% — page-level headings only (Dashboard, Documents, Shipments).
- `display/section-title` — 18px, 600, LH 130%, LS -1% — section headers inside a page.
- `display/card-title` — 16px, 500, LH 20px — card/company/entity names.

**Body:**
- `body/default` — 14px, 400, LH 170% — default paragraph copy.
- `body/secondary` — 13px, 400, LH 160% — muted supporting text.

**Data (numerics — always enable tabular-nums):**
- `data/metric-value` — 18px, 600, LH 120%, LS -2% — standard metric/stat numbers.
- `data/metric-value-lg` — 26px, 600, LH 110%, LS -2% — large dashboard counters.
- `data/mono-id` — 13px, 500, LH 140% — shipment IDs, BOL/container numbers. Case is never transformed — always matches raw data exactly.
- `data/timestamp` — 12px, 400, LH 140% — dates, relative time.

*(Note: `data/metric-value` and `ui/metric-value` are identical specs — flagged in the Figma export as a candidate for consolidation. Treat them as interchangeable until consolidated; do not create a third variant.)*

**Label:**
- `label/eyebrow` — 11px, 600, LH 120%, LS +7% — rare, small tag above a hero title.
- `label/field-label` — 12px, 500, LH 140%, LS +3% — form field labels. **Sentence case, not uppercase.**
- `label/stat-label` — 12px, 500, LH 120%, LS +6% — caption above a big stat number. Uppercase.
- `label/table-header` — 11px, 600, LH 120%, LS +5% — table column headers only. Uppercase.

**UI:**
- `ui/badge-text` — 12px, 500, LH 100%, LS +2% — status pill text. **Sentence case always** ("Active", never "ACTIVE").
- `ui/breadcrumb-current`, `ui/button-label`, `ui/link`, `ui/nav-item`, `ui/tab-label` — standard interactive text styles, sentence case.

**Utility:**
- `utility/empty-state` — 13px, 400, LH 150%.
- `utility/tooltip` — 11px, 400, LH 130%.

### The uppercase rule (only 3 permitted uses)

Uppercase is reserved for EXACTLY three things:
1. Table column headers (`label/table-header`)
2. Stat/metric labels positioned above a number (`label/stat-label`)
3. Eyebrow tags (`label/eyebrow`, rare)

Everything else — including Badge text — is sentence case. Audit any existing UI copy using uppercase outside these three cases; it is out of spec.

---

## 5. Layout Rules

Rules:
- Use the app shell: sidebar, top header, content area.
- Page content aligns to a clear grid.
- Cards only for repeated entities, modals, and contained tools — never cards inside cards.
- No decorative hero sections on operational pages.

### Spacing (token-bound, not fixed pixel guesses)

- **Page padding:** should flex with frame/viewport size rather than a single fixed value — use a responsive padding scale bound to `Spacing/Sp-6` (24px) at narrower widths up to `Spacing/Sp-10` (32px) at wide desktop.
- **Section gap** (between major page sections): `page-section/gap` = 28px (`Spacing/Sp-8`).
- **Content grid gap** (between cards/columns within a section): `content-grid/gap` = 24px (`Spacing/Sp-6`).
- **Metric grid gap** (between KPI cards specifically): `metric-grid/gap` = 16px (`Spacing/Sp-4`).
- **List row spacing:** `list-row/padding-y` = 12px, `list-row/gap` = 12px.
- **Card padding:** `card/padding/compact` = 16px (dense contexts), `card/padding/Default` = 24px (standard cards).
- **Form field gap:** 10–16px, bindable to `Spacing/Sp-2` through `Sp-4`.
- **Table row height:** compact but readable, 40–52px (unchanged).
- **Card/control radius:** `Radius/md` (8px) as the standard ceiling for cards and controls.

### Responsive behavior

- Sidebar is fixed-width and collapsible; content area reflows around it — components themselves do NOT resize/rescale, only the page-level grid changes column count per breakpoint (reflow, not scale).
- Desktop-first: primary supported range is MacBook Air (1280×832) through large desktop. Tablet support for admin/review flows. Mobile must remain usable for approvals, uploads, and partner portal basics.

---

## 6. Navigation Rules

Navigation must strictly follow RBAC.

Rules:
- Sidebar items are visible only when both module and required activity allow them.
- Routes must be guarded with `RequireModule`, `RequireActivity`, or `RequireAnyActivity`.
- Do not rely only on hiding sidebar items; direct URLs must also be protected.
- Login landing must route to the first module/activity the user can access.
- Do not redirect denied users to a page they may not have access to.
- Use `/unauthorized` for access failures.
- Admin-only screens must require the `admin` module and admin activity.

Module examples:
- `dashboard`
- `shipments`
- `tasks`
- `documents`
- `inventory`
- `warehouse`
- `dnd`
- `accounting`
- `reports`
- `partner`
- `portal`
- `admin`

## 7. RBAC and Visibility Rules

This is strict.

Rules:
- If a user does not have a module, that module must not be visible.
- If a user does not have an activity, that action must not be visible or executable.
- A disabled button is not a substitute for permission hiding.
- Use disabled controls for temporary state, validation state, or in-progress saving, not for missing permission.
- Role editor activities must only show for enabled modules.
- Turning a module off must remove that module's selected activities and scopes.
- Backend permission endpoints must filter activities by assigned modules.
- Admin/Super Admin may receive a fallback admin baseline only when role attributes are incomplete.
- Normal user roles must not receive frontend fallback modules.

Partner rule:
- Partner portal may reuse explicitly assigned shipment/document/inventory activities under the `partner` module.
- Do not infer partner access from external category alone.

## 8. Page Structure Rules

Every page should have:
- A clear page title or context label.
- Primary actions near the top-right or in the relevant row.
- Filters/search close to the data they affect.
- Loading, empty, error, and success states.
- Permission-aware actions.

Avoid:
- Duplicate primary actions.
- Floating controls with unclear ownership.
- Hidden workflow steps.
- Explanatory feature text inside the app when the control itself can be clear.

---

## 9. Buttons and Actions

Use `Button` from `frontend/src/components/ui/button.tsx`, bound to the Components-layer Button tokens above.

Rules:
- Primary actions: `variant="primary"` (teal fill).
- Secondary actions: `variant="secondary"` or `outline`.
- Destructive actions: `variant="danger"`.
- Success-confirming actions (rare — e.g. "Approve & complete"): `variant="success"`.
- Icon-only actions (Close, Back, Overflow/More): use Button's **Icon-only mode** — a boolean property that hides the label and centers a swappable icon instance, NOT a separate "Icon Button" component. Close = `icon/x`, Back = `icon/chevron-left`, Overflow = `icon/more-vertical`. All icon-only buttons default to ghost/tertiary variant unless the action itself is primary/destructive.
- **Icon selection must match context, not be chosen freely per instance** — see Section 19 (Icons) for the locked mapping table. Do not swap in an icon that isn't in the approved mapping without a design decision first.
- Icon-only buttons must always pair with a `title`/tooltip/`aria-label`.
- Buttons disabled only during saving/loading or when an action is temporarily impossible — never as a substitute for permission hiding (see RBAC section).

Save buttons: stay enabled except while saving; validate on click; show backend errors on rejection.

## 10. Forms

Rules:
- Group fields into logical sections (reuse **Accordion** for collapsible sections — see Section 15 below).
- Required fields visibly labeled via `label/field-label` (sentence case).
- Preserve entered data when validation fails.
- Show validation errors near the field, using `input/border/error` + `Colour/Status/Danger` text — never color alone (pair with an inline error message).

**Input field behavior (all states, all contexts):**
- Default/resting state uses `input/border/default`.
- **Focus/active state uses `input/border/focus` (teal, `Colour/Accent/Default`)** — in dense contexts like table cells or list forms, this teal border is the correct RESTING look for an empty/editable field (not just an on-click focus ring), since it signals "this needs input" at a glance across a dense page.
- Error state uses `input/border/error` — border/text only, no background fill change.
- Input is never filled with a background tint to indicate state — border color carries all state signaling, background stays `input/bg/default` (or `input/bg/disabled` when disabled) throughout.
- Placeholder text uses `Colour/Text/Muted`.

**Search bar:** there is no separate Search Bar component. **Reuse Input** with a leading `icon/search` and, when the field has a value, an optional trailing clear (`icon/x`) affordance — this is Input's existing leading/trailing icon slot behavior, not a new pattern.

**Checkbox** (multi-select — use only for true multi-select):
- States: Unchecked, Checked, Indeterminate, Disabled-unchecked, Disabled-checked.
- Checked/Indeterminate fill = `Colour/Accent/Default` (teal), white icon (check or minus respectively).
- All states share one fixed box dimension — verified no size drift between states.

**Radio Button** (single-select — mutually exclusive):
- States: Unselected, Selected, Disabled-unselected, Disabled-selected.
- Selected = outer ring + inner filled dot, both `Colour/Accent/Default` — deliberately NOT a full solid fill (distinguishes Radio from Checkbox at a glance despite sharing the accent color).
- Grouping/mutual-exclusivity logic lives at the page/form level, not as a Radio Button component property.

**Toggle Switch** (module on/off toggles — preferred over checkboxes for this use case):
- On = teal track (`Colour/Accent/Default`), white knob. Off = neutral/gray track, white knob. Knob carries a subtle shadow in both states so it stays visible against either track color.

**Segmented Control** (tab-style view switching, e.g. Overview/Analytics/History):
- Max 8 segments, minimum 2. Every tab in a given instance renders at the SAME width — sized dynamically to match whichever label is longest in that specific instance (not a fixed worst-case width across all possible instances). Labels never truncate; 18 characters is the supported per-label maximum.
- Selected segment = elevated white/card pill with shadow; unselected = transparent, `Colour/Text/Secondary`.

---

## 11. Tables and Lists

EWMS is data-heavy; table/row views are preferred over cards for repeated entities.

### Table atoms (packing lists, invoices, BOE, any structured tabular document)

- **Header Cell**: label + optional sort affordance (`icon/arrow-up-down`, sized compactly — never the full-size chevron icon here) + optional dropdown filter. Alignment must match its column's data type (Text = left, Numeric = right).
- **Data Cell** — three types, chosen by what the value actually is:
  - **Auto-populated**: plain text, `Colour/Text/Primary`, regular weight. Use for any value extracted/sourced directly from source documents with no computation involved.
  - **Auto-calculated**: SAME text color as Auto-populated, but **bold weight** — this is the only differentiator. Never give calculated values a different color; bold alone signals "this is a computed result," matching checkout/calculator conventions. Use for SUM(), derived totals, formula outputs.
  - **Input**: border-only styling (`input/border/focus` teal at rest, `input/border/error` on validation failure), no background fill ever. Use for any value the user must manually enter. All Input cells within the same column render at a uniform fixed width regardless of typed content length.
- **Total Cell**: `Colour/Text/Secondary`, right-aligned for numeric totals, left-aligned for the "TOTAL" label cell itself.
- Alignment rule applies uniformly: Numeric content is ALWAYS right-aligned (across Auto-populated, Auto-calculated, and Input types alike) so digits stack cleanly down a column; Text content is left-aligned.
- Header row gets a subtle background fill (lightest neutral) to structurally separate it from body rows — don't rely on font-weight alone.
- Row vertical padding must give clear breathing room (bound to `list-row/padding-y` or equivalent) — cramped rows with text touching cell edges are out of spec.

### List atoms (Shipments, Projects, Documents, Container Tracking — variable column count per list type)

Do NOT build a new fixed-shape "List Item" per list type. Compose from:
- **List Cell** (content-type variants): Stacked-text (title + sub-label), Badge (single or double-stacked), Progress (Progress Bar + optional fraction label), Gate indicator (5-gate compact, 2-state: Completed filled / Yet stroked), Stepper-labeled (Stepper Horizontal, sm size, for fuller step views), Metric (right-aligned number/currency, optional danger-colored text for overdue values), Date (optionally stacked with a status sub-line), Action (Button instance), Chevron (static display icon), Icon tile.
- **List Row**: flexible-count composition (up to 8 named Cell slots, each an instance-swap property with its own visibility boolean) — never a rigid fixed-column shell. This is the actively-in-progress "v2" list architecture; the older fixed "List Item" component is deprecated once v2 is verified.
- **List Header Row**: reuses Header Cell, same 8-slot flexible pattern, paired 1:1 by slot position with its corresponding List Row for width consistency.
- Row states: Default / Hover (`list-row/bg/hover` — `Colours/Gray/50` light, `Colours/Gray/Transparent` dark).

### Responsive column behavior (honest scope note)

Figma defines the tokens, cell atoms, and shared width-pairing contract between Header and Row. **True responsive re-flow (columns adjusting live to container width, e.g. when the side panel collapses/expands) is implemented in code, not solved inside Figma** — Figma cannot express "shrink to fit content but flex within available space" the way CSS grid/flex can. When implementing, bind Header Cell and its paired Data/List Cell to the same width source per column position so alignment never drifts between the two.

---

## 12. Upload and OCR UX

Rules:
- Upload flow must show selected file, document type, shipment assignment, and current processing state.
- Upload and OCR start must return quickly or show a clear backend timeout/error.
- Document type dropdown labels must match admin registry labels.
- Auto-detect should remain available unless a workflow requires explicit type.
- Recently uploaded and processing items should use row view only (reuse List Row v2 / Table atoms per Section 11 — do not build a card-based upload queue).
- Show OCR states in order: uploaded, queued, processing, extracted, validation, approval, complete/error — each state should map to a Badge intent per Section 14's Status→Intent mapping, not a custom one-off treatment.
- On failure, show a retry path only if user has retry/reprocess activity.
- Document type permissions must filter upload options.

## 13. Admin Settings UX

**Uniformity rule (explicit, per instruction):** Admin/Settings pages are NOT a separate design language. They render through the exact same component set as every operational page — Table/List atoms for entity management (users, roles), Accordion for grouped settings sections, Input/Checkbox/Radio/Toggle for configuration forms, Button for actions. Do not introduce admin-specific visual patterns. If an admin screen looks or feels different from a Shipments or Documents page, that is a defect, not a stylistic choice.

Rules:
- Admin settings are operational configuration, not marketing pages.
- Keep sections compact and predictable.
- Use `AdminPageHeader`, `AdminFormSection`, `AdminTable`, `AdminModal`, and shared admin components — these compose from the same Figma-derived atoms as every other page (Table atoms, List Cell v2, Accordion, Modal Shell), not a separate admin-only visual system.
- Hide Teams UI unless team management is explicitly re-enabled.
- The top organisation `Save Changes` button should be enabled and give feedback.
- Advanced mode should be clear and controlled.
- Warn before changes that affect all users — use Warning/Status Modal (Section 15) for this, not a plain toast, since these are consequential confirmations.

Team and Access:
- People, Access Profiles, Organisations/Partners, and Access Audit should remain clear sections.
- Module access is parent access.
- Activity permissions are child access.
- Do not display child activity groups for disabled modules.

---

## 14. Status, Feedback, and Semantics

### Status and Feedback

Rules:
- Every async action needs feedback.
- Use toast for save success, upload completion, and recoverable errors.
- Use inline errors for form validation and field-specific issues.
- Use destructive toasts for failed network or backend validation.
- Keep success messages short.
- Long-running jobs need visible progress or queued state.
- Do not leave buttons stuck in loading state after errors.

### Status Colors and Semantics

Current token-level mapping (confirmed in Figma):
- `Colour/Status/Success` (green) → currently used for: valid, complete, approved, delivered.
- `Colour/Status/Warning` (amber) → currently used for: pending, needs attention, hold.
- `Colour/Status/Danger` (red) → currently used for: failed, rejected, blocked, destructive actions.
- `Colour/Status/Info` (blue) → reserved for: Selected / Started / Info-type states.
- `Colour/Accent/Default` (teal) → currently used for: Active status specifically (distinct from Success green — confirmed intentional in Badge's `active` variant), plus all primary/selected UI chrome (buttons, focus rings, selected tabs).
- Muted gray → inactive, secondary, unavailable, draft.

---

## 15. Modals, Accordion, Doc Viewer, Date Range Picker, Day Cell, Gate Health, Stepper Horizontal, and Banner

### Standing rule: every deliverable must be a true Figma component

Doc Viewer and Gate Health Card were each independently found, in earlier rounds, to have been built as flat one-off frames rather than actual Figma components (no component key, not instance-able, absent from the Assets panel). This is a standing check applied to EVERY component in this system: **before any build is marked complete, confirm it was created as a true Figma component and appears correctly in the Assets/Components panel.** A visually-correct frame that isn't a real component is not a finished deliverable. All components below have been confirmed as true Figma components per this rule.

### Modals and Dialogs — general rules

These rules apply to EVERY modal/dialog regardless of the specific Modal Shell architecture below — they are not superseded by the shell work, they constrain it:

- Use modals for create/edit workflows that do not need a full page. Use full pages for complex workflows with multiple sections or large tables.
- Every modal needs a clear title, a close/cancel affordance, and exactly one primary action — no duplicate primary actions, no ambiguous ownership of floating controls.
- Destructive confirmation modals must explicitly state the entity being affected (e.g. "Delete shipment ZTW-2025-0422?", not just "Are you sure?").
- Modal Save/Create buttons stay enabled except while a request is actively in progress; required-field validation happens on click with clear inline feedback, not by disabling the path forward.
- If the backend rejects the action, show the backend's error message inside the modal, don't just close it silently.

### Modal Shell — architecture (BUILT, confirmed)

- **Modal Shell** (large/complex): header (Title + meta line + optional Segmented Control for related-document tabs + trailing Icon-only Button group for toggle/overflow/close) + FREE CONTENT BODY FRAME (same philosophy as Accordion's body — no structured sub-properties, arbitrary composed content, frequently holds stacked Banner + Accordion instances) + footer (progress display + right-aligned action buttons, fixed structural region, not part of the free body). Centered on page, backdrop blur/dim. Width capped at a max reasonable desktop size (never full-viewport); height hugs content up to a max viewport-relative cap, body scrolls internally beyond that while header/footer stay pinned. Padding: vertical AND horizontal margin from viewport edge always maintained, even at max size.

**Status: built and confirmed as a true Figma component.**

### Warning/Action Modal — architecture (icon removed, CTA color carries intent) (BUILT, confirmed)

**Correction from original spec**: this modal does NOT have an icon. Original builds showed a checkmark icon regardless of actual intent (Delete showed a checkmark in a pink circle, Override showed a checkmark in pale yellow) — icon and background disagreed with each other and neither matched the modal's actual meaning. Icon was removed entirely to eliminate this as a second icon-mapping failure surface (same bug class as Badge/Icon Tile/Calendar icon).

Current correct structure: Title + Message (must support parametrized entity name, e.g. "Delete shipment ZTW-2025-0422?", never generic "Are you sure?") + 1-2 action buttons. NO icon, NO icon slot. Fixed, compact width — no free-content body. Same centered + backdrop treatment as Modal Shell.

**CTA color is the ONLY intent signal, and must match context:**
- Destructive/Delete-type action → primary CTA = Button danger variant (red), never default teal.
- Cautionary/Override-type action → primary CTA = Button danger variant (or warning variant if one is defined).
- Success/acknowledgment-only action (no risky action being confirmed) → primary CTA = standard teal primary.
- Secondary button (Cancel/Go Back) is always Button's secondary/outline variant, regardless of the modal's intent.

**Status: built and confirmed as a true Figma component.**

### Accordion (BUILT, confirmed)

Header (Has leading icon boolean + Label + Has metric badge boolean, reuses Metric Badge + Status as a 4-value TINT property [Neutral/Attention/Success/Warning], not a boolean + Chevron always on). Body is an intentionally free content slot since each accordion's contents differ.

**Status: built and confirmed as a true Figma component.**

### Doc Viewer (BUILT, confirmed)

Bounding-box frame with visible stroke border, placeholder gray fill for the document area itself (actual document rendering is a code concern, not solved in Figma), optional top Segmented-Control tab toggle for multiple source documents (e.g. "PL" / "MTR"), and a floating bottom-center pill control bar containing zoom-out / zoom-percentage / zoom-in / fullscreen-expand icons (Lucide-sourced — `icon/zoom-out`, `icon/zoom-in`, `icon/maximize`).

Placeholder document area proportion: taller, portrait-leaning (~1:1.4, matching real document aspect ratio), sized to read correctly when placed inside a realistic container (e.g. Modal Shell's body).

**Status: built and confirmed as a true Figma component.**

### Day Cell (BUILT, confirmed — componentised from the Calendar Panel's plain day-cell frames)

Component name: `Day Cell`. Type: COMPONENT SET. Dimensions per variant: 36 x 32.

Variant property: `State` = Default | Today | Range-start | Range-middle | Range-end | Disabled.

Token bindings per state:
- **Default:** fill none, text `Colour/Text/Primary`, no radius.
- **Today:** fill none, 1px ring border `Colour/Accent/Default`, radius `Radius/Full`, text `Colour/Accent/Default`.
- **Range-start:** fill `Colours/Zet Teal/300`, radius `Radius/Full` (left side only, or full circle if single-day), text `Colour/Text/Primary` (dark — NOT white).
- **Range-middle:** fill `Colours/Zet Teal/100`, no radius (rectangular wash connecting start to end), text `Colour/Text/Primary`.
- **Range-end:** fill `Colours/Zet Teal/300`, radius `Radius/Full` (right side only, or full circle if single-day), text `Colour/Text/Primary` (dark — NOT white).
- **Disabled:** fill none, text `Colour/Text/Muted`.

Layer structure (same across all states): `Day Cell` [component, centered content] → `Day Number` [text, `data/timestamp` style applied in every state].

The Calendar Panel's Day Grid now uses Day Cell instances (Default state by default) in place of the earlier plain frames.

**Status: built and confirmed as a true Figma component (6 states); Calendar Panel updated to use Day Cell instances.**

### Date Range Picker — Calendar Panel + Open state (BUILT, confirmed)

**Correct structure (locked):** single-month view, Monday-start week (Mo Tu We Th Fr Sa Su), Cancel (secondary Button) + Confirm (primary teal Button) footer — NOT a dual-month Sunday-start layout.

**Range-fill colors (exact, locked — see Day Cell above for the componentised token bindings):**
- Range-start / Range-end day cells: `Colours/Zet Teal/300`.
- Range-middle day cells (the days connecting start and end): `Colours/Zet Teal/100` — visibly lighter than start/end.
- Day-number text on ALL range cells: `Colour/Text/Primary` (dark) — NOT white.
- Today's date marker (if distinct from an active range): outline/ring only in `Colour/Accent/Default`, unaffected by the above.

**Required "Open" composition:** the Trigger component (Range-filled state, showing two separate pill-style "From [date]" / "To [date]" fields side by side — NOT the single "YTD" preset-label style for this composition) is shown stacked directly above the Calendar Panel in the same frame, with the Calendar Panel showing an active in-progress range selection matching the Trigger's displayed dates, plus a text annotation stating the relationship explicitly (e.g. "Trigger + Calendar Panel open. Range [dates] being selected.").

**Calendar Panel footer:** Cancel and Confirm are true Button component instances (outline / primary variants respectively) — not hand-built frames. Day header row (Mo Tu We Th Fr Sa Su) uses `label/table-header` text style.

**Status: built and confirmed as a true Figma component, including the Open composition and footer Button instances.**

### Gate Health Card (BUILT, confirmed)

Sits below KPI cards on the Dashboard page, one card per gate. Header: Gate label (left) + "Active"/"Blocked" column labels (right, above their respective number columns). Body: a REPEATABLE row (icon + Active count in success-green + Blocked count in danger-red, red even at 0) — currently defaulting to exactly 2 rows/cargo types (Container, Break-bulk) for this client, but built as a flexible/repeatable structure rather than a hard-capped 2-row shell, so a future client's gate could show a 3rd cargo type without a rebuild. Card padding matches KPI Card's padding exactly; unlike KPI Card, Gate Health has no shadow and no hover state — it's a static summary display, not an interactive element.

**Icon color:** `Colour/Accent/Default` (teal), applied as a solid FILL on the icon shape itself. Every internal vector path in the Container and Break-bulk icons inherits this fill uniformly (same icon-path-binding audit as Badge/Icon Tile/Calendar).

**Text styles:** "GATE 1" label → `label/field-label`; "Active"/"Blocked" column labels → `label/table-header`; Active/Blocked counts → `data/mono-id`.

**Layout:** cargo row uses Auto Layout space-between (icon left, Active/Blocked counts under their column headers) — the earlier raw 52px spacer-frame hack was removed.

**Status: built and confirmed as a true Figma component.**

### Stepper Horizontal (REBUILT, confirmed — Status now exposed at top level)

**Why rebuilt:** Status was previously buried inside nested Step Node sub-components, causing two silent wrong builds. Status for each step is now settable directly from the top-level properties panel.

**Structure retained:** Component Set with `Size` = default | sm; the underlying Step Node component set (`Status` = completed/active/hold/cancelled/upcoming/overdue) is reused as-is; fixed 7-step slot + connector structure retained.

**Top-level properties (now exposed and bound):**
- `Step 1 Status` through `Step 7 Status`, each = Completed | Active | Hold | Cancelled | Upcoming | Overdue — bound directly to the corresponding nested Step Node's `State` variant.
- `Has Step 3` through `Has Step 7` (visibility booleans). Steps 1 and 2 are always visible.

**Connector color rule (bound logic, not manual):** a connector's color is determined by the node it ARRIVES AT — Completed/Active → `Colour/Status/Success`; Hold → `Colour/Status/Warning`; Cancelled → `Colour/Status/Danger`; Upcoming/Overdue → `Colour/Border/Default`.

**Spacing/text fixes applied:** internal step label spacing → `Spacing/Sp-1` (4px); internal node spacing → `Spacing/Sp-2` (8px); step title → `body/default`; subtitle → `body/secondary`; date → `data/timestamp`.

**Status: rebuilt and confirmed — selecting a Stepper Horizontal instance shows Step 1–7 Status (for visible steps) directly in the top-level properties panel, not buried in layers.**

### Step Row (fixed, confirmed)

Spacing bound to tokens: row gap → `list-row/gap` (12px); content spacing → `Spacing/Sp-1` (4px); header spacing → `Spacing/Sp-2` (8px). Text styles applied: Step title → `body/default`; sub-copy → `body/secondary`; timestamp → `data/timestamp`; overdue message → `body/secondary` + `Colour/Status/Danger`.

**Status: fixed and confirmed.**

### Banner / Notification (BUILT, confirmed)

Inline alert component for page/section-level messaging. Variants — Intent (5 values): Neutral, Info, Warning, Danger, Success.

**Icon (locked set, auto-selected by Intent, not manually pickable):**
- Info → `icon/info`, color = `Colour/Status/Info`
- Warning → `icon/alert-triangle`, color = `Colour/Status/Warning`
- Danger → `icon/alert-circle`, color = `Colour/Status/Danger`
- Success → `icon/check-circle`, color = `Colour/Status/Success`
- Neutral → NO icon

**Background/text per Intent:** bind to the matching `Colour/Status/{Intent} bg` (light tint) for background and `Colour/Status/{Intent}` for text, same Semantics tokens used everywhere else in the system — no new color introduced.

**Structure and properties:**
- Message text (always on).
- `Has link` (boolean, default FALSE) — when true, inserts exactly ONE existing Text Link instance (which already includes its own trailing icon as a swappable instance property — no second, separate arrow icon).
- `Has secondary button` (boolean, default FALSE, independent from `Has link`) — when true, inserts a secondary/outline Button instance for an actual action (e.g. "Dismiss," "Review now"), distinct from a text link.
- `Has close icon` (boolean, default true, independent from the above) — reuses Button's Icon-only mode with `icon/x`.

**Status: built and confirmed as a true Figma component.**

---

---

## 16. Accessibility

Rules:
- All interactive elements must be keyboard reachable.
- Icon-only buttons need labels through `title`, tooltip, or `aria-label`.
- Inputs must have labels.
- Radio and checkbox groups must use proper labels.
- Focus states must be visible.
- Do not communicate status by color alone.
- Text must meet contrast requirements in light and dark mode.
- Avoid tiny hit targets generally; icon buttons in standard toolbar contexts should be about 32px square.
- **Sidebar nav icons specifically are set to 20×20px** (up from the general 16×16px icon size used in dense contexts like badges/table cells) — sidebar items are touch targets on tablet/touchscreen devices, and 16px was assessed as producing cramped, mis-tap-prone hit areas. Pair the 20px icon with generous item padding (not just a larger icon alone) so the effective tap target approaches standard touch-target guidance. **Corresponding Figma Sidebar Shell component needs updating to match — flagged as a pending Figma-side change, not yet applied.**
- Dialogs must have clear title, close/cancel, and primary action.

---

## 17. Responsive Rules

Rules:
- Tables may scroll horizontally when data is dense.
- Forms should stack on small screens.
- Header actions should wrap or move into menus on smaller widths.
- Text must not overflow buttons, badges, cards, or table cells.
- Use stable dimensions for toolbars, boards, counters, and rows.
- Do not make mobile layouts depend on viewport-scaled font sizes.

---

## 18. Copy and Labels

Rules:
- Use action verbs: `Upload`, `Approve`, `Retry`, `Save`, `Create`, `Assign`.
- Use domain language consistently: shipment, document, extraction, validation, approval, container, warehouse, D&D, accounting.
- Avoid long instructional paragraphs inside the app.
- Error text should say what failed and what the user can do.
- Empty states should be short and useful.
- Button labels should not be clever.

Preferred labels:
- `Upload & Process`
- `Documents`
- `My Tasks`
- `D&D Management`
- `Save changes`
- `Access denied`
- `Needs approval`
- `Validated`
- `Retry OCR`

---

## 19. Icons

Rules:
- Use Lucide icons exclusively. Do not hand-draw SVG icons unless no library icon exists.
- **Never introduce an unfamiliar/new icon without explicit approval** — every icon in use must come from the already-established `icon/{name}` set (sourced via the Lucide plugin), added to that set deliberately, not picked ad hoc per component.
- Always pair icons with a tooltip/label — especially icon-only buttons and sidebar items — so meaning is never icon-only.
- Icon color must resolve through the Icon Color token group (`icon/color` aliased per intent: default → `Colour/Text/Primary`, success/warning/danger/info/active/draft/neutral → the matching `badge/text/*` token, on-accent → white). **Known historical bug: icons built as multi-layer vectors sometimes have only ONE path bound to a color variable while sibling paths stay hardcoded** (found and fixed on Badge, Icon Tile, Calendar icon). When adding or auditing any icon, verify EVERY internal path inherits the same bound color — a partially-bound icon will look correct in isolation and then fail silently when swapped into a colored context.

### Locked icon mapping (do not deviate without a design decision)

**Sidebar navigation** (20×20px — see Section 16):
- Dashboard: `LayoutDashboard`
- Shipments: `Ship`
- Tasks: `ClipboardList`
- Documents: `FileText`
- Inventory: `Boxes`
- Warehouse: `Warehouse`
- D&D: `icon/dollar-sign` — **LOCKED**, confirmed already present in the Icons set ("Created in this file," EWMS icon library).
- Accounting: `Receipt` or `DollarSign`
- Reports: `BarChart3`
- Settings/Admin: `Settings`

**KPI Card icons** (used only in the icon+2-submetric dashboard variant — see Section 20 below): **locked** — each KPI's icon reuses the same icon as its corresponding sidebar module (Section 19's locked sidebar mapping above), not a separate icon choice. Shipment Summary → `Ship`, Delivery Summary → `Ship` (or the closest delivery-specific icon if the module later splits from Shipments), Task Summary → `ClipboardList`, Inventory Summary → `Boxes`, D&D Exposure → `icon/dollar-sign`, Budget Monitoring → `Receipt`/`DollarSign` (same as Accounting). This keeps one consistent icon language between sidebar and KPI Card rather than introducing a second, unrelated icon set per metric.

**Common action icons:** Edit → `Pencil`, Delete → `Trash`, Save/confirm → `Check`, Cancel/close → `X`, Back → `chevron-left`, Overflow/more → `more-vertical`, Sort → `arrow-up-down`, Search → `search`.

---

## 20. KPI Card Usage (NEW — variant selection by page context)

KPI Card has two distinct configurations, and which one is used depends entirely on WHERE it appears:

- **Dashboard page**: use the FULL variant — icon + 2 sub-metrics. Has icon = true, Has sub-metrics = true, Sub-metric count = two (except D&D Exposure, which is a confirmed exception at Sub-metric count = one). Has trend = false (icon and trend are documented as mutually exclusive for scannability — icon wins at dashboard level).
- **Any other page** (detail views, module-specific pages, drill-downs): use the MINIMAL variant — label + main metric ONLY. Has icon = false, Has sub-metrics = false, Has trend = true if trend-over-time is relevant to that specific page's context, otherwise false.

Never use the full dashboard variant (icon + sub-metrics) outside the dashboard page itself — this is a deliberate visual hierarchy decision (dashboard = overview/scanning mode, other pages = focused/detail mode) not a stylistic default to apply everywhere.

---

## 21. Component Usage Reference (NEW — quick usage notes per atom)

- **Badge**: single standard for ALL status representation app-wide — no parallel "Status Text" pattern exists or should be built. Route every status string through the Status→Intent mapping (Section 14, pending final confirmation) before assigning a Badge intent — never assign color directly to a status string.
- **Metric Badge**: small inline metric chip, distinct from Badge (status) and KPI Card (dashboard summary) — use for compact inline counts/values within a row or card, not for full metric displays.
- **Progress Bar**: two true variant axes only — Intent (7 values, reusing Badge intent tokens) and Value display (percentage/ratio/none). Has label, Has segmented fill, Secondary intent, Size are properties layered on top, not separate variants.
- **Step Node / Stepper Horizontal / Stepper Vertical**: connector color between two nodes is ALWAYS determined by the status of the node being arrived at, not the node departing. Stepper Horizontal caps at 7 steps (fixed slots + visibility booleans); Stepper Vertical is an unlimited repeatable row, not a capped shell.
- **Gate Indicator**: distinct from the Step Node/Stepper family — fixed at exactly 5 gates, only 2 states (Completed/Yet), used specifically for compact list-row density (e.g. List Cell's Gate indicator content type).
- **Icon Tile**: uses the same 7-value Intent system as Badge (`badge/bg/{intent}` + `badge/text/{intent}`) — never an arbitrary tint-naming scheme.
- **Avatar**: Size (sm/md/lg) + Color variants only — no Shape variant, all avatars are circular.
- **Divider**: Orientation (horizontal/vertical) only — no Style/Color variants unless a genuine need emerges.
- **Breadcrumb**: previous/inactive crumbs are muted (`Colour/Text/Secondary`) by default, turning accent/teal only on hover — never permanently teal, since accent color is reserved for real CTAs, not default chrome.
- **Date Range Picker** (Trigger + Calendar Panel + Day Cell): static visual reference only in Figma — live date math, month navigation, and range-selection interaction are implemented in code.

---

## 22. Data Fetching and State

Rules:
- Use TanStack Query for server state.
- Use component state for local form drafts.
- Invalidate queries after create/update/delete.
- Keep loading states local to the action when possible.
- Do not duplicate fetched data into local state unless editing requires a draft copy.
- Do not fetch data for hidden/permission-denied views.
- Handle empty, error, loading, and success states explicitly.

## 23. Performance

Rules:
- Use virtual lists for long queues or large document lists.
- Avoid unnecessary re-renders from large inline object creation in hot rows.
- Memoize derived lists when filtering/sorting large arrays.
- Keep bundle growth visible; Vite chunk warnings should be reviewed.
- Images/assets must be optimized and sized.
- Do not block the UI while waiting for OCR/job queues.

## 24. Error Handling

Rules:
- Backend errors should be shown to the user when useful.
- Authentication errors should not expose sensitive details.
- Permission errors route to `/unauthorized`.
- Network errors should suggest retrying.
- Job timeout errors should explain that the background service may be unavailable.
- Do not swallow errors silently.

## 25. File and Component Organization

Rules:
- Pages live in `frontend/src/pages`.
- Shared app shell components live in `frontend/src/components`.
- Admin shared components live in `frontend/src/components/admin`.
- Low-level UI primitives live in `frontend/src/components/ui`.
- Contexts live in `frontend/src/contexts`.
- Config and mappings live in `frontend/src/config` or `frontend/src/utils`.
- Types live in `frontend/src/types`.

Component rules:
- Keep components focused.
- Extract repeated row/header/modal patterns.
- Avoid broad refactors during feature work.
- Preserve current naming and style conventions.
- Prefer readable TypeScript over clever abstractions.

## 26. Styling Rules

Rules:
- Prefer Tailwind utility classes for standard styling.
- Use inline styles only where the file already uses them heavily or dynamic values are easier.
- Use CSS variables for theme colors — bound through the Section 3 Figma crosswalk, never a raw hex value.
- Keep border radius at `Radius/md` (8px) or less for cards and controls.
- Avoid nested cards.
- Avoid decorative blobs, gradient orbs, and ornamental backgrounds.
- Avoid one-note palettes.
- Do not introduce large gradients unless the design explicitly calls for it.
- Keep shadows subtle — use the `modal-or-dropdown/shadow` family, do not invent new shadow values.

## 27. Security and Permissions in UI

Rules:
- UI permission checks are not security by themselves; backend must also enforce access.
- Frontend must not show actions a user cannot perform.
- Backend permission payload is the source of truth.
- Do not infer access from role name except the explicit Admin/Super Admin fallback.
- Do not infer partner access from user category alone.
- Always consider direct URL access.

## 28. Testing and Verification

Before finishing frontend work:
- Run `npm.cmd run build` in `frontend`.
- Run targeted backend compile/tests when backend permission or API code changes.
- Check that sidebar items match permissions.
- Check direct URL denial routes.
- Check light and dark theme if styling changed.
- Check empty/loading/error states for new data screens.
- Check responsive behavior for major page layouts.
- Check that Save buttons reset loading state on failure.
- **Check that every color/spacing/radius value traces back to a named Figma token via the Section 3 crosswalk, with zero hardcoded hex/pixel values.**

Manual RBAC checklist:
- Role with only `documents` sees only document routes/actions.
- Role without `warehouse` cannot see Warehouse or open `/inventory/warehouse`.
- Role without `dnd` cannot see D&D or open `/inventory/dnd`.
- Partner role sees only partner portal items.
- Customer role sees only customer portal items.
- Admin sees admin/settings and normal modules.
- User with no allowed landing route goes to `/unauthorized`.

## 29. Definition of Done

A frontend change is done when:
- The workflow works end to end.
- UI follows existing visual patterns (Figma-derived tokens/components, per Section 3 crosswalk).
- Permission visibility is strict.
- Direct routes are guarded.
- Loading, empty, error, and success states exist.
- Text fits at common viewport sizes.
- Build passes.
- The change is scoped and does not rewrite unrelated UI.

## 30. Review Checklist

Use this during code review:
- Does the screen expose only allowed modules and activities?
- Are buttons enabled/disabled for the right reasons?
- Are Save/Create flows validated on click with useful errors?
- Are tables or row views used for dense operational data?
- Are colors from tokens — traced through the Section 3 Figma crosswalk, not hardcoded?
- Are icons from Lucide, and do they match the locked mapping in Section 19?
- Is the layout stable on desktop and mobile?
- Are forms grouped logically?
- Are async states clear?
- Are direct URLs protected?
- Did the build pass?
- Does every modal follow the title/close/single-primary-action rule in Section 15?

---

## 31. Figma File Organization (Canvas Structure — for agent component discovery)

The Figma canvas is organized into **9 named Figma Sections** (native Section tool, not frames-as-sections), one page only. This is how an agent (or a human) locates any component on the canvas without searching. The earlier 10th section, "Foundations" (color/type/spacing swatches), was removed — primitives and semantics already exist as Figma Variables, which is the actual source of truth the agent binds against, so an empty visual-swatch section added no value and was cut.

Current section order:

| # | Section | Contains |
|---|---|---|
| 01 | Actions | Button (all variants/sizes/states), Text Link |
| 02 | Status & Data | Badge, Status Indicator, Progress Bar, Metric Badge |
| 03 | Inputs & Forms | Input (all states), Checkbox, Radio Button, Toggle Switch, Segmented Control, Filter Chip, Filter Trigger |
| 04 | Navigation | Nav Item, Nav Group, Sidebar Shell, Breadcrumb, Profile Trigger |
| 05 | Data Display | Header Cell, Data Cell (all 3 types), Total Cell, Table Header Row, Table Row, List Cell v2, List Row v2, List Header Row v2 |
| 06 | Feedback | Banner, Tooltip |
| 07 | Overlays | Dropdown Panel, Option Row, Overflow Menu (Trigger + Panel + Item), Date Range Picker (Trigger + Calendar Panel + Day Cell + Open State composition), Modal Shell, Warning/Action Modal |
| 08 | Visualization | Step Node, Step Row, Stepper Horizontal, Gate Indicator, Gate Health Card, KPI Card, Icon Tile, Column Legend Dot |
| 09 | Media & Misc | Icon set (~30+ icons), Avatar, Logo Mark, Icon Badge, Divider, Doc Viewer, Accordion |

**Naming rule (critical for agent navigation):** every component sheet frame inside a section must carry the component's exact name as its frame title (e.g. `Badge — All Variants`), never a generic name like `Frame 47`. A generically-named frame is effectively invisible to an agent navigating by name.

**Matrix layout within each component sheet (top to bottom):** Row 1 = all variants/intents left to right; Row 2 = all sizes left to right (if applicable); Row 3 = all states left to right; Row 4 = boolean combinations that matter (e.g. with/without icon). Spacing: 24px between instances in a row, 40px between rows, 32px sheet padding. Each sheet has a `display/section-title` label above it (navigation text only, not part of any component instance).

**Canvas flow:** sections flow left to right then wrap (not one long horizontal strip) — roughly 3 sections wide, 120px gap between sections.

**Variables vs. canvas:** Primitives and Semantics tokens live in Figma's Variables panel and are what components actually bind to — they do not need a visual swatch section on canvas to function. If a future need arises for a human-facing visual token reference, add it as documentation generated from the Variables panel, not the other way around.

---

## Open items requiring confirmation before this rulebook is considered final

This rulebook has no remaining open items requiring confirmation.
