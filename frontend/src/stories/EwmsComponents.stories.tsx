import type { Meta, StoryObj } from '@storybook/react-vite';
import { Boxes, FileText, Ship, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Banner,
  CalendarPanel,
  ColumnLegendDot,
  DataCell,
  DateRangePickerOpen,
  DateRangeTrigger,
  DayCell,
  DocViewer,
  EwmsScrollbar,
  FilterChip,
  FilterTrigger,
  GateHealthCard,
  GateIndicator,
  HeaderCell,
  IconBadge,
  IconTile,
  ListCell,
  ListHeaderRow,
  ListRow,
  LogoMark,
  LogoRow,
  MetricBadge,
  ModalShell,
  ProfileTrigger,
  SegmentedControl,
  StatusIndicator,
  StepNode,
  StepRow,
  StepperHorizontal,
  TableHeaderRow,
  TableRow,
  TextLink,
  WarningActionModal,
} from '@/components/ewms';

const meta = {
  title: 'Design System/EWMS Components',
  parameters: {
    docs: {
      description: {
        component: 'Shared React replacements for the top-level EWMS Figma design-system components.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActionsAndStatus: Story = {
  render: () => (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <TextLink href="#">Text link</TextLink>
        <StatusIndicator status="Pending Approval" />
        <MetricBadge value="+15%" label="vs last week" intent="success" trend="up" />
        <MetricBadge value="4" label="blocked" intent="danger" trend="down" />
      </div>
      <Banner intent="warning" link={<TextLink href="#">Review</TextLink>}>
        Validation needs attention before this document can move forward.
      </Banner>
    </div>
  ),
};

export const InputsAndForms: Story = {
  render: () => (
    <div className="grid max-w-xl gap-4">
      <div className="flex flex-wrap gap-2">
        <FilterChip active>Documents</FilterChip>
        <FilterChip onRemove={() => undefined}>Pending approval</FilterChip>
        <FilterTrigger activeCount={2} />
      </div>
      <SegmentedControl
        value="active"
        onValueChange={() => undefined}
        options={[
          { value: 'all', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'blocked', label: 'Blocked' },
        ]}
      />
      <div className="flex items-center gap-4">
        <DateRangeTrigger label="YTD" />
        <DateRangePickerOpen />
      </div>
      <div className="flex gap-1">
        <DayCell day={15} state="selected" />
        <DayCell day={16} state="range-middle" />
        <DayCell day={31} state="today" />
      </div>
      <CalendarPanel />
    </div>
  ),
};

export const NavigationAndMedia: Story = {
  render: () => (
    <div className="grid max-w-xl gap-5">
      <div className="rounded-xl bg-sidebar p-3">
        <ProfileTrigger name="EWMS Admin" role="Super Admin" />
      </div>
      <div className="flex items-center gap-4">
        <LogoMark />
        <LogoRow subtitle="Enterprise workflow management" />
        <IconBadge icon={Ship} label="Shipments" intent="active" />
        <IconTile icon={Boxes} intent="info" />
        <ColumnLegendDot intent="success" />
        <EwmsScrollbar />
      </div>
      <DocViewer title="Packing list" />
    </div>
  ),
};

export const DataDisplay: Story = {
  render: () => (
    <div className="grid max-w-4xl gap-5">
      <div className="overflow-hidden rounded-lg border border-border">
        <TableHeaderRow columns={[
          { key: 'shipment', label: 'Shipment' },
          { key: 'status', label: 'Status' },
          { key: 'docs', label: 'Docs', align: 'right' },
        ]} />
        <TableRow className="grid-cols-3">
          <DataCell>SHP-001</DataCell>
          <DataCell><StatusIndicator status="Active" /></DataCell>
          <DataCell numeric type="calculated">8/12</DataCell>
        </TableRow>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <ListHeaderRow className="grid-cols-[1.2fr_1fr_120px_24px]">
          <HeaderCell>Shipment</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell align="right">Documents</HeaderCell>
          <span />
        </ListHeaderRow>
        <ListRow className="grid-cols-[1.2fr_1fr_120px_24px]">
          <ListCell primary="SHP-2026-001" secondary="BOL-5519" />
          <ListCell kind="badge" status="Pending Approval" />
          <ListCell kind="progress" progress={{ current: 8, total: 12 }} />
          <ListCell kind="chevron" />
        </ListRow>
      </div>
    </div>
  ),
};

export const Visualization: Story = {
  render: () => (
    <div className="grid max-w-4xl gap-5">
      <div className="flex items-center gap-4">
        <StepNode status="completed" label="Upload" />
        <StepNode status="active" label="Review" />
        <GateIndicator gates={[true, true, true, false, false]} />
      </div>
      <StepperHorizontal
        steps={[
          { label: 'Upload', status: 'completed' },
          { label: 'OCR', status: 'completed' },
          { label: 'Review', status: 'active' },
          { label: 'Approve', status: 'upcoming' },
        ]}
      />
      <StepRow title="Document uploaded" description="Packing List entered processing" timestamp="10:32" status="completed" />
      <div className="grid grid-cols-3 gap-3">
        <GateHealthCard title="Gate 1" active={12} blocked={0} />
        <GateHealthCard title="Gate 2" active={8} blocked={2} />
        <GateHealthCard title="Gate 3" active={4} blocked={1} />
      </div>
    </div>
  ),
};

export const Overlays: Story = {
  render: () => (
    <div className="grid gap-4">
      <ModalShell
        open
        onOpenChange={() => undefined}
        title="Modal Shell"
        description="Create/edit workflows use this shell."
        footer={<Button>Save changes</Button>}
      >
        <div className="rounded-lg border border-border p-4">Free content body</div>
      </ModalShell>
      <WarningActionModal
        open={false}
        onOpenChange={() => undefined}
        title="Delete shipment?"
        description="This action cannot be undone."
        entity={<span className="inline-flex items-center gap-2"><FileText className="size-4" />SHP-2026-001</span>}
        confirmLabel="Delete"
        onConfirm={() => undefined}
      />
      <Button variant="danger"><Trash2 /> Destructive action</Button>
    </div>
  ),
};
