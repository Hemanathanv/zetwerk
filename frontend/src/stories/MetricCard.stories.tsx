import type { Meta, StoryObj } from '@storybook/react-vite';
import { Boxes, ClipboardList, DollarSign, Ship } from 'lucide-react';
import { MetricCard } from '@/components/vs/MetricCard';

const meta = {
  title: 'Visualization/KPI Card',
  component: MetricCard,
  parameters: {
    docs: {
      description: {
        component:
          'Dashboard KPI card. Per the EWMS intent guide: icon=true, sub-metrics=true, trend=false. D&D Exposure may use one sub-metric.',
      },
    },
  },
  args: {
    label: 'Shipment Summary',
    value: 128,
    icon: Ship,
    color: 'teal',
    sideStats: [
      { value: 42, label: 'Active' },
      { value: 8, label: 'Blocked' },
    ],
  },
} satisfies Meta<typeof MetricCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DashboardVariant: Story = {};

export const DndExposureException: Story = {
  args: {
    label: 'D&D Exposure',
    value: '$18.4k',
    icon: DollarSign,
    color: 'danger',
    sideStats: [{ value: 7, label: 'LFD 7d' }],
  },
};

export const ModuleExamples: Story = {
  render: () => (
    <div className="grid max-w-5xl grid-cols-3 gap-4">
      <MetricCard
        label="Shipment Summary"
        value={128}
        icon={Ship}
        color="teal"
        sideStats={[
          { value: 42, label: 'Active' },
          { value: 8, label: 'Blocked' },
        ]}
      />
      <MetricCard
        label="Task Summary"
        value={31}
        icon={ClipboardList}
        color="info"
        sideStats={[
          { value: 12, label: 'Needs review' },
          { value: 4, label: 'Overdue' },
        ]}
      />
      <MetricCard
        label="Inventory Summary"
        value={284}
        icon={Boxes}
        color="success"
        sideStats={[
          { value: 210, label: 'Available' },
          { value: 18, label: 'Blocked' },
        ]}
      />
    </div>
  ),
};
