import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, MoreVertical, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  args: {
    children: 'Save changes',
  },
  parameters: {
    docs: {
      description: {
        component:
          'Buttons use EWMS component tokens. Icon-only actions require an accessible label or title.',
      },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Check />
        Save changes
      </Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">
        <Trash2 />
        Delete
      </Button>
      <Button variant="ghost" size="icon" aria-label="Close" title="Close">
        <X />
      </Button>
      <Button variant="ghost" size="icon" aria-label="More actions" title="More actions">
        <MoreVertical />
      </Button>
    </div>
  ),
};
