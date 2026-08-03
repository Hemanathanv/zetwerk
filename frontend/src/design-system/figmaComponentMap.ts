export const EWMS_FIGMA_FILE = {
  fileKey: 'llUianBiNvDwBdthSXRUZt',
  pageNodeId: '62:2',
  url: 'https://www.figma.com/design/llUianBiNvDwBdthSXRUZt/EWMS_Design-System?node-id=62-2',
} as const;

export type FigmaComponentStatus = 'implemented' | 'partial' | 'needs-code-component' | 'reference-only';

export type FigmaComponentMapEntry = {
  section: string;
  figmaName: string;
  figmaNodeId: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  codePath?: string;
  storyPath?: string;
  status: FigmaComponentStatus;
  notes?: string;
};

export const figmaComponentMap: FigmaComponentMapEntry[] = [
  { section: '01 / Actions', figmaName: 'Button', figmaNodeId: '92:439', type: 'COMPONENT_SET', codePath: 'src/components/ui/button.tsx', storyPath: 'src/stories/Button.stories.tsx', status: 'implemented', notes: 'Figma axes: Intent, Size, State, Icon only.' },
  { section: '01 / Actions', figmaName: 'Text Link', figmaNodeId: '139:300', type: 'COMPONENT_SET', codePath: 'src/components/ewms/TextLink.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '02 / Status & Data', figmaName: 'Badge', figmaNodeId: '102:129', type: 'COMPONENT_SET', codePath: 'src/components/ui/badge.tsx', storyPath: 'src/stories/Badge.stories.tsx', status: 'implemented' },
  { section: '02 / Status & Data', figmaName: 'Status Indicator', figmaNodeId: '106:26', type: 'COMPONENT_SET', codePath: 'src/components/ewms/StatusIndicator.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '02 / Status & Data', figmaName: 'Progress Bar', figmaNodeId: '312:2081', type: 'COMPONENT_SET', codePath: 'src/components/vs/ProgressBar.tsx', storyPath: 'src/stories/ProgressBar.stories.tsx', status: 'implemented' },
  { section: '02 / Status & Data', figmaName: 'Metric Badge', figmaNodeId: '109:94', type: 'COMPONENT_SET', codePath: 'src/components/ewms/MetricBadge.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Input', figmaNodeId: '116:1764', type: 'COMPONENT_SET', codePath: 'src/components/ui/input.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Checkbox', figmaNodeId: '739:3401', type: 'COMPONENT_SET', codePath: 'src/components/ui/checkbox.tsx', storyPath: 'src/stories/Controls.stories.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Radio Button', figmaNodeId: '739:3420', type: 'COMPONENT_SET', codePath: 'src/components/ui/radio-group.tsx', storyPath: 'src/stories/Controls.stories.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Toggle Switch', figmaNodeId: '671:1889', type: 'COMPONENT_SET', codePath: 'src/components/ui/switch.tsx', storyPath: 'src/stories/Controls.stories.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Segmented Control', figmaNodeId: '672:5549', type: 'COMPONENT_SET', codePath: 'src/components/ewms/SegmentedControl.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Filter Chip', figmaNodeId: '123:23', type: 'COMPONENT', codePath: 'src/components/ewms/FilterControls.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '03 / Inputs & Forms', figmaName: 'Filter Trigger', figmaNodeId: '123:22', type: 'COMPONENT_SET', codePath: 'src/components/ewms/FilterControls.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '04 / Navigation', figmaName: 'Nav Item', figmaNodeId: '224:361', type: 'COMPONENT_SET', codePath: 'src/components/Sidebar.tsx', status: 'implemented' },
  { section: '04 / Navigation', figmaName: 'Nav Group', figmaNodeId: '224:364', type: 'COMPONENT', codePath: 'src/components/Sidebar.tsx', status: 'implemented' },
  { section: '04 / Navigation', figmaName: 'Sidebar Shell', figmaNodeId: '224:1018', type: 'COMPONENT_SET', codePath: 'src/components/Sidebar.tsx', status: 'implemented' },
  { section: '04 / Navigation', figmaName: 'Breadcrumb Item', figmaNodeId: '312:570', type: 'COMPONENT_SET', codePath: 'src/components/ui/breadcrumb.tsx', status: 'implemented' },
  { section: '04 / Navigation', figmaName: 'Breadcrumb', figmaNodeId: '312:571', type: 'COMPONENT', codePath: 'src/components/ui/breadcrumb.tsx', status: 'implemented' },
  { section: '04 / Navigation', figmaName: 'Profile Trigger', figmaNodeId: '224:415', type: 'COMPONENT_SET', codePath: 'src/components/ewms/ProfileTrigger.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'Header Cell', figmaNodeId: '664:1568', type: 'COMPONENT_SET', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'Data Cell', figmaNodeId: '660:1582', type: 'COMPONENT_SET', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'Table Header Row', figmaNodeId: '664:1569', type: 'COMPONENT', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'Table Row', figmaNodeId: '664:1620', type: 'COMPONENT', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'List Cell v2', figmaNodeId: '701:2296', type: 'COMPONENT_SET', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'List Row v2', figmaNodeId: '701:6076', type: 'COMPONENT_SET', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '05 / Data Display', figmaName: 'List Header Row v2', figmaNodeId: '701:6077', type: 'COMPONENT', codePath: 'src/components/ewms/DataDisplay.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '06 / Feedback', figmaName: 'Banner', figmaNodeId: '767:3762', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Banner.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '06 / Feedback', figmaName: 'Tooltip', figmaNodeId: '224:216', type: 'COMPONENT_SET', codePath: 'src/components/ui/tooltip.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Dropdown Panel', figmaNodeId: '144:43', type: 'COMPONENT', codePath: 'src/components/ui/dropdown-menu.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Option Row', figmaNodeId: '144:18', type: 'COMPONENT_SET', codePath: 'src/components/ui/select.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Date Range Trigger', figmaNodeId: '691:6158', type: 'COMPONENT_SET', codePath: 'src/components/ewms/DateRangePickerVisual.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Calendar Panel', figmaNodeId: '766:3661', type: 'COMPONENT', codePath: 'src/components/ewms/DateRangePickerVisual.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Day Cell', figmaNodeId: '786:1162', type: 'COMPONENT_SET', codePath: 'src/components/ewms/DateRangePickerVisual.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Date Range Picker / Open', figmaNodeId: '782:1394', type: 'COMPONENT', codePath: 'src/components/ewms/DateRangePickerVisual.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented', notes: 'Visual shell implemented; live date math remains in consuming pages.' },
  { section: '07 / Overlays', figmaName: 'Modal Shell', figmaNodeId: '787:1269', type: 'COMPONENT', codePath: 'src/components/ewms/Modals.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '07 / Overlays', figmaName: 'Warning/Action Modal', figmaNodeId: '787:1380', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Modals.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Step Node', figmaNodeId: '344:883', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Step Row', figmaNodeId: '345:1012', type: 'COMPONENT', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Stepper Horizontal', figmaNodeId: '345:1011', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Gate Node', figmaNodeId: '571:1228', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Gate Indicator', figmaNodeId: '582:2654', type: 'COMPONENT', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Gate Health Card', figmaNodeId: '777:4248', type: 'COMPONENT', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'KPI Card', figmaNodeId: '270:1231', type: 'COMPONENT_SET', codePath: 'src/components/vs/MetricCard.tsx', storyPath: 'src/stories/MetricCard.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Icon Tile', figmaNodeId: '328:684', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '08 / Visualization', figmaName: 'Column Legend Dot', figmaNodeId: '328:688', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Avatar', figmaNodeId: '249:1068', type: 'COMPONENT', codePath: 'src/components/ui/avatar.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Logo Mark', figmaNodeId: '249:1066', type: 'COMPONENT', codePath: 'src/components/ewms/Media.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Icon Badge', figmaNodeId: '224:209', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Visualization.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Divider', figmaNodeId: '328:691', type: 'COMPONENT_SET', codePath: 'src/components/ui/separator.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Doc Viewer', figmaNodeId: '775:3942', type: 'COMPONENT', codePath: 'src/components/ewms/Media.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Doc Viewer / With Tabs', figmaNodeId: '775:3958', type: 'COMPONENT', codePath: 'src/components/ewms/Media.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Logo Row', figmaNodeId: '224:424', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Media.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
  { section: '09 / Media & Misc', figmaName: 'Scrollbar', figmaNodeId: '802:1415', type: 'COMPONENT_SET', codePath: 'src/components/ewms/Media.tsx', storyPath: 'src/stories/EwmsComponents.stories.tsx', status: 'implemented' },
];
