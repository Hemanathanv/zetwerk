import { useState } from 'react';
import { Shipment, trackingEvents, documents, activityEvents } from '@/data/mockData';
import { StageTracker } from './StageTracker';
import { TrackingTimeline } from './TrackingTimeline';
import { DocumentStatusBoard } from './DocumentStatusBoard';
import { ActivityFeed } from './ActivityFeed';
import { StatusBadge } from './StatusBadge';

type Tab = 'overview' | 'tracking' | 'documents' | 'activity';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracking', label: 'Live Tracking' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
];

const overviewFields = [
  { label: 'Customer', value: 'Unimatics' },
  { label: 'Source System', value: 'Zetwerk / MSD' },
  { label: 'CHA Agent', value: 'Rajan Logistics' },
  { label: 'Freight Forwarder', value: 'Bolloré Logistics' },
  { label: 'Carrier Line', value: 'Maersk' },
  { label: 'Container No.', value: 'MSCU-7834521' },
  { label: 'Master BOL', value: 'BOL-77821' },
  { label: 'Booking No.', value: 'BK-99182' },
  { label: 'Invoice Value', value: '$84,250.00' },
  { label: 'Current Owner', value: 'Operations Team' },
];

type ShipmentDetailPanelProps = {
  shipment: Shipment | undefined;
};

export function ShipmentDetailPanel({ shipment }: ShipmentDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  if (!shipment) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-[14.5px]">
        Select a shipment to view details
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="shipment-detail-panel">
      {/* Panel header */}
      <div
        className="px-4 pt-4 pb-0 border-b"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">{shipment.id}</span>
              <StatusBadge status={shipment.status} />
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {shipment.invoiceNo} · {shipment.carrier} · ETA {shipment.eta}
            </p>
          </div>
          <span className="text-[13px] font-medium text-muted-foreground">{shipment.stage}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {overviewFields.map((field) => (
                <div
                  key={field.label}
                  className="rounded-md border px-3 py-2"
                  style={{ borderColor: 'hsl(var(--border))' }}
                  data-testid={`overview-field-${field.label.toLowerCase().replace(/ /g, '-')}`}
                >
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{field.label}</p>
                  <p className="text-[13px] font-medium text-foreground mt-0.5 truncate">{field.value}</p>
                </div>
              ))}
            </div>

            {/* Stage Tracker */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Shipment Progress</p>
              <StageTracker activeStage={2} />
            </div>
          </div>
        )}

        {activeTab === 'tracking' && (
          <div>
            <TrackingTimeline events={trackingEvents} />
          </div>
        )}

        {activeTab === 'documents' && (
          <DocumentStatusBoard documents={documents} />
        )}

        {activeTab === 'activity' && (
          <ActivityFeed events={activityEvents} />
        )}
      </div>
    </div>
  );
}
