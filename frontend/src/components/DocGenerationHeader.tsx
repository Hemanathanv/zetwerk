import { SegmentedControl } from '@/components/ewms/SegmentedControl';
import { Badge } from '@/components/ui/badge';

export type DocGenerationTabOption = { type: string; label: string };

/**
 * Shared document-type tab row for the Document Generation section
 * (Packing List / Outward GRN / Draft CBP FORM 7501). The page title and
 * subtitle live in the global page header (via usePageMeta), matching the
 * Upload & Process page — this row only renders the tabs + pending badge,
 * so it's identical across all three routes and only the active tab moves.
 */
export function DocGenerationTabs({
  activeType,
  options,
  onSelectType,
  pendingCount,
}: {
  activeType: string;
  options: DocGenerationTabOption[];
  onSelectType: (type: string) => void;
  pendingCount?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
      <SegmentedControl
        value={activeType}
        onValueChange={onSelectType}
        options={options.map(option => ({ value: option.type, label: option.label }))}
      />
      {pendingCount !== undefined && (
        <Badge intent={pendingCount > 0 ? 'warning' : 'success'} size="sm">
          {pendingCount > 0 ? `${pendingCount} pending` : 'All approved'}
        </Badge>
      )}
    </div>
  );
}
