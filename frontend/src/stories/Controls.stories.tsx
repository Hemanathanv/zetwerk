import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

const meta = {
  title: 'Inputs & Forms/Control Selection',
  parameters: {
    docs: {
      description: {
        component:
          'Toggle is for module/feature on-off settings, checkbox is multi-select, and radio is mutually exclusive single-select.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CorrectUsage: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-5 text-sm">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <span>Documents module</span>
        <Switch defaultChecked aria-label="Enable Documents module" />
      </div>
      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <Checkbox id="bulk-row" />
        <label htmlFor="bulk-row">Select shipment row for bulk action</label>
      </div>
      <RadioGroup defaultValue="L4" className="rounded-lg border bg-card p-4">
        <label className="mb-3 block text-sm font-medium">Role level</label>
        <div className="flex gap-4">
          {['L1', 'L2', 'L3', 'L4'].map((level) => (
            <label key={level} className="flex items-center gap-2">
              <RadioGroupItem value={level} />
              {level}
            </label>
          ))}
        </div>
      </RadioGroup>
    </div>
  ),
};
