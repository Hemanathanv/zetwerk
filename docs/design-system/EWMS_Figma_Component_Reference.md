# EWMS Figma Component Reference

Source map: `frontend/src/design-system/figmaComponentMap.ts`  
Figma file: `llUianBiNvDwBdthSXRUZt`  
Rulebook: `docs/design-system/EWMS_Frontend_UIUX-Rulebook_Updated.md`  
Intent guide: `docs/design-system/EWMS_Component_Intent_Guide.md`

Use this inventory with the Rulebook and Intent Guide before changing any EWMS UI. Figma tells what components and variants exist; the Rulebook defines tokens, structure, RBAC, layout, and accessibility; the Intent Guide defines which variant/configuration belongs in a given page context.

Live MCP verification completed against the Figma file. The live file has one page, `Components`, with the 9 Rulebook sections plus an `Icons` area. The live inventory found 125 top-level Figma assets: 60 non-icon design-system assets and 65 icon assets.

## Component Inventory

| Section | Figma component | Node | Type | Code reference | Required doc reference |
|---|---|---:|---|---|---|
| 01 / Actions | Button | `92:439` | Component set | `frontend/src/components/ui/button.tsx` | Rulebook sections 3, 9, 16, 19 |
| 01 / Actions | Text Link | `139:300` | Component set | `frontend/src/components/ewms/TextLink.tsx` | Rulebook sections 3, 9, 18 |
| 02 / Status & Data | Badge | `102:129` | Component set | `frontend/src/components/ui/badge.tsx` | Rulebook sections 3, 14, 21; Intent Guide Badge / Status Indicator |
| 02 / Status & Data | Status Indicator | `106:26` | Component set | `frontend/src/components/ewms/StatusIndicator.tsx` | Rulebook sections 14, 21; Intent Guide Badge / Status Indicator |
| 02 / Status & Data | Progress Bar | `312:2081` | Component set | `frontend/src/components/vs/ProgressBar.tsx` | Rulebook section 21; Intent Guide Progress Bar |
| 02 / Status & Data | Metric Badge | `109:94` | Component set | `frontend/src/components/ewms/MetricBadge.tsx` | Rulebook sections 3, 21 |
| 03 / Inputs & Forms | Input | `116:1764` | Component set | `frontend/src/components/ui/input.tsx` | Rulebook sections 3, 10, 16 |
| 03 / Inputs & Forms | Checkbox | `739:3401` | Component set | `frontend/src/components/ui/checkbox.tsx` | Rulebook sections 10, 16; Intent Guide Toggle Switch vs. Checkbox vs. Radio Button |
| 03 / Inputs & Forms | Radio Button | `739:3420` | Component set | `frontend/src/components/ui/radio-group.tsx` | Rulebook sections 10, 16; Intent Guide Toggle Switch vs. Checkbox vs. Radio Button |
| 03 / Inputs & Forms | Toggle Switch | `671:1889` | Component set | `frontend/src/components/ui/switch.tsx` | Rulebook sections 10, 16; Intent Guide Toggle Switch vs. Checkbox vs. Radio Button |
| 03 / Inputs & Forms | Segmented Control | `672:5549` | Component set | `frontend/src/components/ewms/SegmentedControl.tsx` | Rulebook sections 10, 21; Intent Guide Segmented Control |
| 03 / Inputs & Forms | Filter Chip | `123:23` | Component | `frontend/src/components/ewms/FilterControls.tsx` | Rulebook sections 3, 8, 10 |
| 03 / Inputs & Forms | Filter Trigger | `123:22` | Component set | `frontend/src/components/ewms/FilterControls.tsx` | Rulebook sections 3, 8, 10 |
| 04 / Navigation | Nav Item | `224:361` | Component set | `frontend/src/components/Sidebar.tsx` | Rulebook sections 3, 6, 16, 19 |
| 04 / Navigation | Nav Group | `224:364` | Component | `frontend/src/components/Sidebar.tsx` | Rulebook sections 6, 16, 19 |
| 04 / Navigation | Sidebar Shell | `224:1018` | Component set | `frontend/src/components/Sidebar.tsx` | Rulebook sections 5, 6, 16, 19; Prompt extra attention: collapsed logo/toggle and scroll behavior |
| 04 / Navigation | Breadcrumb Item | `312:570` | Component set | `frontend/src/components/ui/breadcrumb.tsx` | Rulebook sections 3, 21 |
| 04 / Navigation | Breadcrumb | `312:571` | Component | `frontend/src/components/ui/breadcrumb.tsx` | Rulebook sections 3, 21 |
| 04 / Navigation | Profile Trigger | `224:415` | Component set | `frontend/src/components/ewms/ProfileTrigger.tsx` | Rulebook sections 6, 16 |
| 05 / Data Display | Header Cell | `664:1568` | Component set | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 3, 14, 21; Intent Guide Table atoms |
| 05 / Data Display | Data Cell | `660:1582` | Component set | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 3, 14, 21; Intent Guide Table atoms |
| 05 / Data Display | Table Header Row | `664:1569` | Component | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 14, 21; Intent Guide Table atoms |
| 05 / Data Display | Table Row | `664:1620` | Component | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 14, 21; Intent Guide Table atoms |
| 05 / Data Display | List Cell v2 | `701:2296` | Component set | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 14, 21; Intent Guide List Cell / List Row / List Header Row |
| 05 / Data Display | List Row v2 | `701:6076` | Component set | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 14, 21; Intent Guide List Cell / List Row / List Header Row |
| 05 / Data Display | List Header Row v2 | `701:6077` | Component | `frontend/src/components/ewms/DataDisplay.tsx` | Rulebook sections 14, 21; Intent Guide List Cell / List Row / List Header Row |
| 06 / Feedback | Banner | `767:3762` | Component set | `frontend/src/components/ewms/Banner.tsx` | Rulebook sections 15, 16 |
| 06 / Feedback | Tooltip | `224:216` | Component set | `frontend/src/components/ui/tooltip.tsx` | Rulebook sections 16, 21 |
| 07 / Overlays | Dropdown Panel | `144:43` | Component | `frontend/src/components/ui/dropdown-menu.tsx` | Rulebook sections 3, 15, 16 |
| 07 / Overlays | Option Row | `144:18` | Component set | `frontend/src/components/ui/select.tsx` | Rulebook sections 10, 15, 16 |
| 07 / Overlays | Date Range Trigger | `691:6158` | Component set | `frontend/src/components/ewms/DateRangePickerVisual.tsx` | Rulebook section 21; Intent Guide Date Range Picker |
| 07 / Overlays | Calendar Panel | `766:3661` | Component | `frontend/src/components/ewms/DateRangePickerVisual.tsx` | Rulebook section 21; Intent Guide Date Range Picker |
| 07 / Overlays | Day Cell | `786:1162` | Component set | `frontend/src/components/ewms/DateRangePickerVisual.tsx` | Rulebook section 21; Intent Guide Date Range Picker |
| 07 / Overlays | Date Range Picker / Open | `782:1394` | Component | `frontend/src/components/ewms/DateRangePickerVisual.tsx` | Rulebook section 21; Intent Guide Date Range Picker |
| 07 / Overlays | Modal Shell | `787:1269` | Component | `frontend/src/components/ewms/Modals.tsx` | Rulebook sections 15, 16; Intent Guide Modal Shell vs. Warning/Action Modal |
| 07 / Overlays | Warning/Action Modal | `787:1380` | Component set | `frontend/src/components/ewms/Modals.tsx` | Rulebook sections 15, 16; Intent Guide Modal Shell vs. Warning/Action Modal |
| 08 / Visualization | Step Node | `344:883` | Component set | `frontend/src/components/ewms/Visualization.tsx` | Rulebook section 21; Intent Guide Step Node / Stepper Horizontal / Stepper Vertical |
| 08 / Visualization | Step Row | `345:1012` | Component | `frontend/src/components/ewms/Visualization.tsx` | Rulebook section 21; Intent Guide Step Node / Stepper Horizontal / Stepper Vertical |
| 08 / Visualization | Stepper Horizontal | `345:1011` | Component set | `frontend/src/components/ewms/Visualization.tsx` | Rulebook section 21; Intent Guide Step Node / Stepper Horizontal / Stepper Vertical |
| 08 / Visualization | Gate Node | `571:1228` | Component set | `frontend/src/components/ewms/Visualization.tsx` | Rulebook section 21; Intent Guide Stepper/Gate Indicator distinction |
| 08 / Visualization | Gate Indicator | `582:2654` | Component | `frontend/src/components/ewms/Visualization.tsx` | Rulebook section 21; Intent Guide Stepper/Gate Indicator distinction |
| 08 / Visualization | Gate Health Card | `777:4248` | Component | `frontend/src/components/ewms/Visualization.tsx` | Rulebook sections 20, 21; Intent Guide Gate Health Card |
| 08 / Visualization | KPI Card | `270:1231` | Component set | `frontend/src/components/vs/MetricCard.tsx` | Rulebook sections 20, 21; Intent Guide KPI Card |
| 08 / Visualization | Icon Tile | `328:684` | Component set | `frontend/src/components/ewms/Visualization.tsx` | Rulebook sections 19, 21 |
| 08 / Visualization | Column Legend Dot | `328:688` | Component set | `frontend/src/components/ewms/Visualization.tsx` | Rulebook sections 3, 21 |
| 09 / Media & Misc | Avatar | `249:1068` | Component | `frontend/src/components/ui/avatar.tsx` | Rulebook sections 16, 21 |
| 09 / Media & Misc | Logo Mark | `249:1066` | Component | `frontend/src/components/ewms/Media.tsx` | Rulebook sections 6, 19 |
| 09 / Media & Misc | Icon Badge | `224:209` | Component set | `frontend/src/components/ewms/Visualization.tsx` | Rulebook sections 19, 21 |
| 09 / Media & Misc | Divider | `328:691` | Component set | `frontend/src/components/ui/separator.tsx` | Rulebook sections 3, 21 |
| 09 / Media & Misc | Doc Viewer | `775:3942` | Component | `frontend/src/components/ewms/Media.tsx` | Rulebook section 21; Intent Guide Doc Viewer |
| 09 / Media & Misc | Doc Viewer / With Tabs | `775:3958` | Component | `frontend/src/components/ewms/Media.tsx` | Rulebook section 21; Intent Guide Doc Viewer and Segmented Control |
| 09 / Media & Misc | Logo Row | `224:424` | Component set | `frontend/src/components/ewms/Media.tsx` | Rulebook sections 6, 19 |
| 09 / Media & Misc | Scrollbar | `802:1415` | Component set | `frontend/src/components/ewms/Media.tsx` | Rulebook sections 3, 5, 17, 21; Prompt extra attention: shared Scrollbar pattern |

## Live Figma Assets Not In The Code Map

These exist in the live Figma file but are not currently represented in `frontend/src/design-system/figmaComponentMap.ts`.

| Section | Figma component | Node | Type | Guidance |
|---|---|---:|---|---|
| 05 / Data Display | List Item | `468:1235` | Component set | Deprecated by Intent Guide List Cell/List Row v2. Do not use for new work. |
| 05 / Data Display | List Item | `564:11128` | Component set | Deprecated by Intent Guide List Cell/List Row v2. Do not use for new work. |
| 05 / Data Display | List Item Header | `572:1240` | Component | Legacy/deprecated alongside List Item. Prefer List Header Row v2. |
| 05 / Data Display | List Item Header | `585:2706` | Component | Legacy/deprecated alongside List Item. Prefer List Header Row v2. |
| 05 / Data Display | Projects List | `564:11003` | Component set | Legacy composed list asset. Prefer List Cell/List Row v2 composition per Intent Guide. |
| 05 / Data Display | Sort Indicator | `576:1457` | Component set | Table/list support asset. Use only inside Header Cell/List Header contexts. |
| 08 / Visualization | Stepper Dot | `476:1592` | Component set | Legacy/support asset. Prefer Step Node / Stepper Horizontal / Step Row per Intent Guide. |

## Live Icon Components

The live Figma file includes these icon components. Per Rulebook section 19, use Lucide icons and the locked icon mapping; do not introduce or swap icons outside the established set without a design decision.

`Icon/panel-left-close`, `Icon/panel-left-open`, `icon/alert-circle`, `icon/alert-triangle`, `icon/arrow-left`, `icon/arrow-right`, `icon/arrow-up-down`, `icon/ban`, `icon/bar-chart-2`, `icon/bell`, `icon/break-bulk`, `icon/calendar`, `icon/check`, `icon/check-circle`, `icon/chevron-down`, `icon/chevron-left`, `icon/chevron-right`, `icon/chevron-up`, `icon/clock`, `icon/code`, `icon/container`, `icon/copy`, `icon/credit-card`, `icon/doc-generate`, `icon/dollar-sign`, `icon/edit-2`, `icon/external-link`, `icon/eye`, `icon/eye-off`, `icon/file-text`, `icon/filter`, `icon/folder`, `icon/git-branch`, `icon/globe`, `icon/help-circle`, `icon/inbox`, `icon/info`, `icon/inventory`, `icon/layers`, `icon/layout-dashboard`, `icon/log-out`, `icon/moon`, `icon/more-horizontal`, `icon/more-vertical`, `icon/platform`, `icon/plus`, `icon/reports`, `icon/schema ref`, `icon/search`, `icon/settings`, `icon/shield`, `icon/shipments`, `icon/sun`, `icon/tasks`, `icon/terminal`, `icon/trash-2`, `icon/upload`, `icon/user`, `icon/users`, `icon/wand-2`, `icon/warehouse`, `icon/x`, `icon/zap`.

Duplicate live icon names found: `icon/arrow-up-down` appears at `572:1229` and `582:2844`; `icon/warehouse` appears at `241:1055` and `241:1061`. Treat this as a design-system cleanup flag before adding new icon mappings.

## Reconciliation Rules

1. Start from this inventory, then inspect the module file-by-file.
2. For every component usage, confirm the code component above is used before creating a page-local pattern.
3. Check Rulebook first for token, spacing, radius, typography, accessibility, RBAC, and structure.
4. Check Intent Guide second for context-specific variant/configuration.
5. If a component or context is missing from both docs, flag it. Do not invent a new token, variant, or pattern.
6. Sidebar Shell and Scrollbar must be explicitly included in every module reconciliation report.

## Live Figma Verification Note

Initial rich metadata calls returned `INVALID_ARGUMENT` when requesting component property metadata in bulk. A smaller MCP query succeeded and verified the live page/section/component inventory. This document records that successful live inventory; it does not include full variant property definitions for every component set.
