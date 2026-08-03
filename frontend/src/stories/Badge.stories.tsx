import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@/components/ui/badge';
import { intentForStatus } from '@/design-system/componentIntent';

const meta = {
  title: 'Status & Data/Badge',
  component: Badge,
  args: {
    children: 'Validated',
    intent: 'success',
    hasDot: true,
  },
  parameters: {
    docs: {
      description: {
        component:
          'Badge is the single standard status display. Convert raw status text to an intent before rendering.',
      },
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const IntentMapping: Story = {
  render: () => {
    const statuses = [
      'Draft',
      'Pending Approval',
      'OCR Processing',
      'Active',
      'Validated',
      'Rejected',
      'Blocked',
    ];

    return (
      <div className="flex flex-wrap gap-2">
        {statuses.map((status) => (
          <Badge key={status} intent={intentForStatus(status)} hasDot>
            {status}
          </Badge>
        ))}
      </div>
    );
  },
};
