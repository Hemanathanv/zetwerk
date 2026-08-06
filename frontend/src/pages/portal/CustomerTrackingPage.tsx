import { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import {
  ArrowLeft, Ship, Truck, CheckCircle, Check, FileText, Download,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ''}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-48 mt-4" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-28 rounded-lg mt-4" />
      <Skeleton className="h-4 w-20 mt-6" />
      <div className="space-y-4 mt-3">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}
      </div>
    </div>
  );
}

// ─── Journey Timeline ─────────────────────────────────────────────────────────

function JourneyTimeline({ milestones }: { milestones: any[] }) {
  if (!milestones.length) return null;

  return (
    <div className="mb-8">
      <h2 className="text-[14.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-4">
        Journey
      </h2>
      <div className="space-y-0">
        {milestones.map((ms, idx) => {
          const isLast = idx === milestones.length - 1;
          const isCompleted = ms.status === 'COMPLETED';
          const isActive =
            !isCompleted &&
            idx > 0 &&
            milestones[idx - 1]?.status === 'COMPLETED';

          return (
            <div key={ms.id} className="flex items-start gap-4 relative">
              {/* Connector line */}
              {!isLast && (
                <div
                  className={`absolute left-[11px] top-[24px] bottom-0 w-0.5 ${
                    isCompleted ? 'bg-teal-400' : 'bg-muted'
                  }`}
                />
              )}

              {/* Dot */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 mt-0.5 ${
                  isCompleted
                    ? 'bg-teal-500'
                    : isActive
                    ? 'bg-background border-2 border-teal-500 ring-4 ring-teal-500/20'
                    : 'bg-muted'
                }`}
              >
                {isCompleted && <Check className="w-3.5 h-3.5 text-white" />}
                {isActive && (
                  <div className="w-2 h-2 rounded-full bg-teal-500" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pb-6">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[14.5px] ${
                      isCompleted
                        ? 'font-medium'
                        : isActive
                        ? 'font-semibold text-teal-700 dark:text-teal-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {ms.label}
                  </span>
                  {ms.completedAt && (
                    <span className="text-[13px] text-muted-foreground font-mono">
                      {new Date(ms.completedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </div>
                {isActive && (
                  <p className="text-[13px] text-teal-600 dark:text-teal-400 mt-0.5">
                    Currently here
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerTrackingPage() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id;

  const [shipment, setShipment] = useState<any>(null);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [podDocument, setPodDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!shipmentId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/portal/tracking/${shipmentId}`, {
      headers: authHeaders(),
    })
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return; }
        const d = await r.json();
        setShipment(d.data?.shipment ?? null);
        setMilestones(d.data?.milestones ?? []);
        setContainers(d.data?.containers ?? []);
        setPodDocument(d.data?.podDocument ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [shipmentId]);

  if (loading) return <LoadingSkeleton />;

  if (notFound || !shipment) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <a
          href="/portal"
          className="text-[14.5px] text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Your Orders
        </a>
        <div className="bg-card rounded-lg border border-border p-12 text-center mt-4">
          <h3 className="text-[14.5px] font-semibold">Shipment not found</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            This shipment doesn't exist or isn't part of your orders.
          </p>
        </div>
      </div>
    );
  }

  const overallStage = shipment.overallStage;
  const isDelivered = shipment.status === 'COMPLETED';
  const heroColor =
    overallStage?.progress === 100
      ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900'
      : overallStage?.progress >= 70
      ? 'bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-900'
      : 'bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900';

  const heroBarColor =
    overallStage?.progress === 100 ? 'bg-green-500' : 'bg-teal-500';

  const heroIcon =
    overallStage?.progress === 100 ? (
      <CheckCircle className="w-6 h-6 text-green-600" />
    ) : overallStage?.progress >= 70 ? (
      <Truck className="w-6 h-6 text-teal-600" />
    ) : (
      <Ship className="w-6 h-6 text-blue-600" />
    );

  // Earliest delivery ETA across containers
  const etaContainer = containers
    .filter((c) => c.etaDelivery)
    .sort(
      (a, b) =>
        new Date(a.etaDelivery).getTime() - new Date(b.etaDelivery).getTime()
    )[0];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Back link */}
      <a
        href="/portal"
        className="text-[14.5px] text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Your Orders
      </a>

      {/* Shipment header */}
      <div className="mb-6 mt-4">
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2, fontFamily: 'var(--app-font-sans)' }}>
          {shipment.shipmentNumber || 'Processing'}
        </h1>
        <div className="flex items-center gap-2 text-[14.5px] text-muted-foreground mt-1 flex-wrap">
          {shipment.project && (
            <a href="/portal" className="hover:underline">
              {shipment.project.projectCode}
            </a>
          )}
          {shipment.portOfLoading && shipment.destination && (
            <>
              <span>·</span>
              <span>
                From {shipment.portOfLoading} to {shipment.destination}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Status hero card */}
      <div className={`rounded-lg p-6 mb-8 ${heroColor}`}>
        <div className="flex items-center gap-3 mb-3">
          {heroIcon}
          <div>
            <div className="text-lg font-semibold">
              {overallStage?.label || 'Processing'}
            </div>
            {isDelivered && (
              <div className="text-[14.5px] text-green-600 dark:text-green-400">
                Your order has been delivered
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 rounded-full bg-white/50 dark:bg-black/20 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all ${heroBarColor}`}
            style={{ width: `${overallStage?.progress ?? 0}%` }}
          />
        </div>

        {/* ETA */}
        {!isDelivered && (
          <div className="flex items-center justify-between text-[14.5px] mt-3">
            <span className="text-muted-foreground">Estimated delivery</span>
            {etaContainer ? (
              <span className="font-medium">
                {new Date(etaContainer.etaDelivery).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            ) : (
              <span className="text-muted-foreground text-[13px]">Calculating...</span>
            )}
          </div>
        )}
      </div>

      {/* Journey timeline */}
      <JourneyTimeline milestones={milestones} />

      {/* Containers */}
      {containers.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[14.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Container{containers.length !== 1 ? 's' : ''}
          </h2>
          <div className="space-y-3">
            {containers.map((c) => (
              <div key={c.id} className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14.5px] font-mono font-semibold">
                      {c.containerNumber}
                    </div>
                    <div className="text-[13px] text-muted-foreground mt-0.5">
                      {c.friendlyStatus}
                      {c.currentLocation && (
                        <span> · {c.currentLocation}</span>
                      )}
                    </div>
                  </div>
                  {c.vesselName && (
                    <div className="text-right">
                      <div className="text-[13px] text-muted-foreground">Vessel</div>
                      <div className="text-[13px] font-medium">{c.vesselName}</div>
                    </div>
                  )}
                </div>

                {/* Per-container milestone progress (PATCH2) */}
              {containers.length > 1 && c.containerMilestones && c.containerMilestones.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.containerMilestones.map((cm: any) => (
                      <div
                        key={cm.milestoneNumber}
                        title={`#${cm.milestoneNumber} ${cm.name}: ${cm.status}`}
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${cm.status === 'COMPLETED' ? 'bg-teal-500' : 'bg-muted'}`}
                      />
                    ))}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-1">
                    {c.containerMilestones.filter((cm: any) => cm.status === 'COMPLETED').length}/{c.containerMilestones.length} milestones
                  </div>
                </div>
              )}

              {(c.etaPort || c.etaDelivery) &&
                  c.friendlyStatus !== 'Delivered' && (
                    <div className="flex gap-4 mt-3 pt-3 border-t border-border text-[13px]">
                      {c.etaPort && (
                        <div>
                          <span className="text-muted-foreground">Port arrival: </span>
                          <span className="font-mono font-medium">
                            {new Date(c.etaPort).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      )}
                      {c.etaDelivery && (
                        <div>
                          <span className="text-muted-foreground">Delivery: </span>
                          <span className="font-mono font-medium">
                            {new Date(c.etaDelivery).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proof of Delivery */}
      {podDocument && (
        <div className="mb-8">
          <h2 className="text-[14.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Proof of Delivery
          </h2>
          <div className="bg-card rounded-lg border border-border p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-teal-600" />
              <div>
                <div className="text-[14.5px] font-medium">Delivery confirmation</div>
                <div className="text-[13px] text-muted-foreground">
                  {podDocument.fileName || 'POD document'}
                </div>
              </div>
            </div>
            <a
              href={`${API_BASE}/api/documents/${podDocument.id}/download`}
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </div>
        </div>
      )}

      {/* POD pending — shipment delivered but no doc yet */}
      {!podDocument && isDelivered && (
        <div className="mb-8">
          <h2 className="text-[14.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Proof of Delivery
          </h2>
          <div className="bg-card rounded-lg border border-border p-4 text-center">
            <FileText className="w-6 h-6 mx-auto text-muted-foreground/40" />
            <p className="text-[13px] text-muted-foreground mt-2">
              Proof of Delivery document is being processed and will be
              available shortly.
            </p>
          </div>
        </div>
      )}

      {/* Order Details */}
      <div className="mb-8">
        <h2 className="text-[14.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Order Details
        </h2>
        <div className="bg-card rounded-lg border border-border p-4 space-y-2.5">
          {shipment.shipmentNumber && (
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">Shipment reference</span>
              <span className="font-mono font-medium">{shipment.shipmentNumber}</span>
            </div>
          )}
          {shipment.project?.projectCode && (
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">Purchase order</span>
              <span className="font-mono font-medium">
                {shipment.project.projectCode}
              </span>
            </div>
          )}
          {shipment.portOfLoading && (
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">Origin</span>
              <span>{shipment.portOfLoading}</span>
            </div>
          )}
          {shipment.destination && (
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">Destination</span>
              <span>{shipment.destination}</span>
            </div>
          )}
          {containers.length > 0 && (
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">Containers</span>
              <span className="font-mono">{containers.length}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
