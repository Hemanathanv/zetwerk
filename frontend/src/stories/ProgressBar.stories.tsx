import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressBar } from '@/components/vs/ProgressBar';

const meta = {
  title: 'Status & Data/Progress Bar',
  component: ProgressBar,
  args: {
    current: 20,
    total: 100,
    intent: 'success',
    label: 'Progress',
    valueDisplay: 'percentage',
    size: 'default',
    hasLabel: true,
  },
  parameters: {
    docs: {
      description: {
        component:
          'Figma axes: Intent, Value display, Size. Label and segmented fill are layered properties, not separate variants.',
      },
    },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Percentage: Story = {};

export const RatioInline: Story = {
  args: {
    current: 7,
    total: 12,
    valueDisplay: 'ratio',
    hasLabel: false,
  },
};

export const SegmentedFill: Story = {
  args: {
    current: 48,
    total: 100,
    secondaryValue: 18,
    intent: 'active',
    hasSegmentedFill: true,
    value: '48 active / 18 blocked',
  },
};

export const IntentMatrix: Story = {
  render: () => (
    <div className="grid max-w-xl gap-4">
      {(['success', 'warning', 'danger', 'info', 'active', 'draft', 'neutral'] as const).map((intent) => (
        <ProgressBar
          key={intent}
          current={35}
          total={100}
          intent={intent}
          label={intent}
          valueDisplay="percentage"
          hasLabel
        />
      ))}
    </div>
  ),
};
