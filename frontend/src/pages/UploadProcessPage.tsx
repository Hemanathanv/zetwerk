import { useState, useRef, useEffect, useCallback } from 'react';
import { documentApi } from '@/auth/api';
import type { DocType, DocumentClassificationResponse, DocumentRecord } from '@/types/backend';
import { useLocation } from 'wouter';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  UploadCloud, FolderOpen, Database, ChevronDown, ChevronRight,
  Sparkles, CheckCircle2,
  LayoutList, LayoutGrid, ChevronRight as ArrowRight,
  SlidersHorizontal, Zap, RotateCw,
} from 'lucide-react';
import { PageHeader }    from '@/components/vs/PageHeader';
import { StatusPill }    from '@/components/vs/StatusPill';
import { DocBadge }      from '@/components/vs/DocBadge';
import { FilterChips }   from '@/components/vs/FilterChips';
import { useToast } from '@/hooks/use-toast';

// ─── Design tokens ───────────────────────────────────────────────────────────
const TEAL   = 'hsl(173 58% 39%)';
const FG     = 'hsl(var(--foreground))';
const MUTED  = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const GREEN  = 'hsl(152 69% 31%)';
const AMBER  = 'hsl(38 92% 50%)';
const RED    = 'hsl(0 84% 60%)';
const BLUE   = 'hsl(221 83% 53%)';
const INFO   = 'hsl(201 96% 32%)';
const GOLD   = 'hsl(43 96% 56%)';
const GOLD_BG = 'hsla(43,96%,56%,0.10)';

// ─── Pipeline dots ────────────────────────────────────────────────────────────
type DotState = 'done' | 'current' | 'current-spin' | 'future';
const STAGE_LABELS = ['Upload', 'Extract', 'Approve', 'Cross-val', 'Close'];

const DOC_TYPE_SELECT_OPTIONS: Array<{ value: DocType | 'auto'; label: string; group?: string }> = [
  { value: 'auto', label: 'Auto-detect', group: 'General' },
  { value: 'SALES_INVOICE', label: 'Sales Invoice', group: 'Gate 1 - Initiation' },
  { value: 'PACKING_LIST', label: 'Packing List', group: 'Gate 1 - Initiation' },
  { value: 'SHIPPING_BILL', label: 'Shipping Bill', group: 'Gate 1 - Initiation' },
  { value: 'BILL_OF_LADING', label: 'Bill of Lading', group: 'Gate 2 - India Exit' },
  { value: 'ENTRY_SUMMARY', label: 'Entry Summary', group: 'Gate 3 - US Entry' },
  { value: 'ENTRY_SUMMARY_TARIFF_LINES', label: 'Entry Summary Tariff Lines', group: 'Gate 3 - US Entry' },
  { value: 'US_CARGO_RELEASE_ORDER', label: 'US Cargo Release', group: 'Gate 3 - US Entry' },
  { value: 'US_CUSTOMS_RELEASE_ORDER', label: 'US Customs Release', group: 'Gate 3 - US Entry' },
  { value: 'US_DELIVERY_ORDER', label: 'US Delivery Order', group: 'Gate 4 - 3PL' },
  { value: 'GRN_INBOUND', label: 'GRN Inbound', group: 'Gate 4 - 3PL' },
  { value: 'US_SALES_INVOICE', label: 'US Sales Invoice', group: 'Gate 5 - Delivery' },
  { value: 'US_PACKING_LIST', label: 'US Packing List', group: 'Gate 5 - Delivery' },
  { value: 'CHA_BILL', label: 'CHA Bill', group: 'Parallel' },
  { value: 'FREIGHT_FORWARDER_BILL', label: 'FF Bill', group: 'Parallel' },
  { value: 'OCEAN_FREIGHT', label: 'Ocean Freight', group: 'Parallel' },
  { value: 'CUSTOMER_BROKER_BILL', label: 'Broker Bill', group: 'Parallel' },
  { value: 'PORT_TO_WH', label: 'Port-to-WH Bill', group: 'Parallel' },
  { value: 'WH_TO_CUSTOMER', label: 'WH-to-Customer Bill', group: 'Parallel' },
];

function labelForDocType(value: DocType | string) {
  return DOC_TYPE_SELECT_OPTIONS.find((option) => option.value === value)?.label ?? String(value).replace(/_/g, ' ');
}

function errorDescription(err: unknown, fallback: string) {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return err instanceof Error ? err.message : fallback;
}

function PipelineDots({ dots, gold }: { dots: DotState[]; gold?: boolean }) {
  const activeColor = gold ? GOLD : TEAL;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {dots.map((dot, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{
              width: 9, height: 9, borderRadius: '50%',
              backgroundColor:
                dot === 'done'    ? activeColor :
                dot === 'current' || dot === 'current-spin' ? activeColor :
                'hsl(var(--border))',
              boxShadow: (dot === 'current' || dot === 'current-spin')
                ? `0 0 0 3px ${gold ? 'hsla(43,96%,56%,0.25)' : 'hsla(173,58%,39%,0.25)'}`
                : 'none',
              opacity: dot === 'future' ? 0.35 : 1,
              position: 'relative',
            }}>
              {dot === 'current-spin' && (
                <div style={{
                  position: 'absolute', inset: -3, borderRadius: '50%',
                  border: `2px solid ${INFO}`, borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                }} />
              )}
            </div>
            <span style={{ fontSize: 8, color: dot === 'future' ? MUTED : FG, opacity: dot === 'future' ? 0.4 : 0.7, whiteSpace: 'nowrap' }}>
              {STAGE_LABELS[i]}
            </span>
          </div>
          {i < dots.length - 1 && (
            <div style={{
              width: 18, height: 1,
              backgroundColor: dot === 'done' ? activeColor : 'hsl(var(--border))',
              opacity: 0.5, flexShrink: 0, marginBottom: 10,
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Queue card component ─────────────────────────────────────────────────────
type StatusCategory = 'uploaded' | 'needs-approval' | 'processing' | 'cross-validating' | 'draft-review' | 'done';

type QueueCard = {
  id: string;
  docId?: string;          // real DB document UUID — set for live API docs
  document?: DocumentRecord;
  headerColor: string;
  docCode: string;
  docType: string;
  isGenerated?: boolean;
  issuer: string;
  docNumber: string;
  status: string;
  statusVariant: 'info' | 'warning' | 'pending' | 'validated';
  statusCategory: StatusCategory;
  avgConfidence: number | null;       // 0-1, from Gemini OCR when extraction completes
  dots: DotState[];
  goldDots?: boolean;
  detail: React.ReactNode;
  action?: { label: string; primary?: boolean; teal?: boolean; onClick?: () => void; href?: string };
  canReExtract?: boolean;
  context: string;
  timestamp: string;
};

function QueueCardEl({ card, onApproveClick, onReExtractClick, onCardClick, selected, selectable, onSelect, autoEligible, retrying }: {
  card: QueueCard;
  onApproveClick?: () => void;
  onReExtractClick?: () => void;
  onCardClick?: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  autoEligible?: boolean;
  retrying?: boolean;
}) {
  const [, navigate] = useLocation();
  const [hovered, setHovered] = useState(false);
  const confPct = card.avgConfidence == null ? null : Math.round(card.avgConfidence * 100);
  const confColor = card.avgConfidence == null ? AMBER : card.avgConfidence >= 0.95 ? GREEN : card.avgConfidence >= 0.85 ? AMBER : RED;
  const confText = confPct === null ? 'Not available' : `${confPct}%`;
  const confHint = confPct === null
    ? (card.statusCategory === 'processing' ? 'Waiting for Gemini OCR' : 'Re-run OCR to get score')
    : 'Gemini OCR score';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onCardClick}
      style={{
        backgroundColor: 'hsl(var(--card))',
        borderRadius: 12, overflow: 'hidden',
        border: selected ? `1.5px solid ${BLUE}` : autoEligible ? `1.5px solid ${GREEN}` : `1px solid ${BORDER}`,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.12s',
        cursor: onCardClick ? 'pointer' : 'default',
        boxShadow: selected
          ? `0 0 0 3px hsla(221,83%,53%,0.14)`
          : hovered ? '0 4px 16px hsla(220,14%,10%,0.12)' : 'var(--vs-shadow-card)',
      }}
    >
      {/* Colored top strip */}
      <div style={{ height: 3, backgroundColor: card.headerColor }} />

      {/* Body */}
      <div style={{ padding: '10px 14px 12px' }}>
        {/* Row 1: identity + pill */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* Checkbox */}
            {selectable && (
              <div
                onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
                style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                  border: `2px solid ${selected ? BLUE : BORDER}`,
                  backgroundColor: selected ? BLUE : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.1s, background-color 0.1s',
                }}
              >
                {selected && <div style={{ width: 7, height: 5, borderLeft: '2px solid #fff', borderBottom: '2px solid #fff', transform: 'rotate(-45deg)', marginTop: -2 }} />}
              </div>
            )}
            <DocBadge code={card.docCode} size="md" />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: FG }}>{card.docType}</span>
                {card.isGenerated && <Sparkles size={13} style={{ color: GOLD, flexShrink: 0 }} />}
                {autoEligible && !selected && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999, backgroundColor: `${GREEN}18`, color: GREEN, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Zap size={8} /> auto
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: MUTED }}>{card.issuer}</span>
              <br />
              <span className="vs-mono" style={{ fontSize: 10.5, color: FG }}>{card.docNumber}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {card.statusVariant === 'info' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                backgroundColor: 'hsla(221,83%,53%,0.12)', color: BLUE,
              }}>
                {card.status}
              </span>
            ) : card.statusVariant === 'validated' ? (
              <span style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                backgroundColor: GOLD_BG, color: 'hsl(38 92% 30%)',
                display: 'inline-block',
              }}>
                {card.status}
              </span>
            ) : (
              <StatusPill status={card.status} variant={card.statusVariant} />
            )}
            <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>{card.timestamp}</div>
          </div>
        </div>

        {/* Row 2: Pipeline */}
        <div style={{ marginTop: 8 }}>
          <PipelineDots dots={card.dots} gold={card.goldDots} />
        </div>

        {/* Row 3: Status detail */}
        <div style={{ marginTop: 7, fontSize: 11.5, color: FG }}>
          {card.detail}
        </div>

        <div style={{
          marginTop: 9,
          padding: '8px 10px',
          borderRadius: 8,
          border: `1px solid ${confColor}35`,
          backgroundColor: `${confColor}0f`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Confident score
            </div>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{confHint}</div>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: confColor, flexShrink: 0 }}>
            {confText}
          </span>
        </div>

        {/* Row 4: Shipment context */}
        <div style={{ marginTop: 4, fontSize: 10.5, color: MUTED }}>
          <span className="vs-mono" style={{ fontSize: 10 }}>{card.context}</span>
        </div>

        {/* Row 5: Actions */}
        {card.action && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {card.action.label === 'View details →' ? (
              <button
                onClick={(e) => { e.stopPropagation(); onCardClick?.(); }}
                style={{
                  fontSize: 11.5, fontWeight: 500, color: TEAL,
                  background: 'none', border: `1px solid ${TEAL}40`, borderRadius: 6,
                  padding: '4px 10px', cursor: 'pointer',
                }}
              >
                View details →
              </button>
            ) : card.action.teal ? (
              <button
                onClick={(e) => { e.stopPropagation(); card.action?.href ? navigate(card.action.href) : card.action?.onClick?.(); }}
                style={{
                  fontSize: 12, fontWeight: 700, color: '#fff',
                  backgroundColor: TEAL, border: 'none', borderRadius: 6,
                  padding: '5px 12px', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Sparkles size={11} />
                {card.action.label}
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); (onApproveClick ?? card.action?.onClick)?.(); }}
                style={{
                  fontSize: 12, fontWeight: 700, color: '#fff',
                  backgroundColor: BLUE, border: 'none', borderRadius: 6,
                  padding: '5px 12px', cursor: 'pointer',
                }}
              >
                {card.action.label}
              </button>
            )}
          </div>
        )}
        {card.canReExtract && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={(e) => { e.stopPropagation(); onReExtractClick?.(); }}
              disabled={retrying}
              style={{
                fontSize: 11.5, fontWeight: 700, color: FG,
                background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 6,
                padding: '4px 10px', cursor: retrying ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5, opacity: retrying ? 0.65 : 1,
              }}
            >
              <RotateCw size={11} style={retrying ? { animation: 'spin 0.8s linear infinite' } : undefined} />
              Re-extract
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compact row component ────────────────────────────────────────────────────
function MiniPipeline({ dots, gold }: { dots: DotState[]; gold?: boolean }) {
  const active = gold ? GOLD : TEAL;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {dots.map((dot, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            backgroundColor: dot === 'future' ? 'hsl(var(--border))' : active,
            opacity: dot === 'future' ? 0.3 : 1,
            position: 'relative',
          }}>
            {dot === 'current-spin' && (
              <div style={{
                position: 'absolute', inset: -2, borderRadius: '50%',
                border: `1.5px solid ${INFO}`, borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
          </div>
          {i < dots.length - 1 && (
            <div style={{
              width: 10, height: 1,
              backgroundColor: dot === 'done' ? active : 'hsl(var(--border))',
              opacity: 0.4, flexShrink: 0,
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function QueueRowEl({ card, onApproveClick, onReExtractClick, onRowClick, selected, selectable, onSelect, autoEligible, retrying, style }: {
  card: QueueCard;
  onApproveClick?: () => void;
  onReExtractClick?: () => void;
  onRowClick?: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  autoEligible?: boolean;
  retrying?: boolean;
  style?: React.CSSProperties;
}) {
  const [, navigate] = useLocation();
  const [hovered, setHovered] = useState(false);
  const confPct = card.avgConfidence == null ? null : Math.round(card.avgConfidence * 100);
  const confColor = card.avgConfidence == null ? AMBER : card.avgConfidence >= 0.95 ? GREEN : card.avgConfidence >= 0.85 ? AMBER : RED;
  const confText = confPct === null ? 'Not available' : `${confPct}%`;

  return (
    <div
      onClick={onRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 14px', height: 46,
        backgroundColor: selected
          ? 'hsla(221,83%,53%,0.06)'
          : autoEligible
            ? `${GREEN}08`
            : hovered ? 'hsl(var(--muted) / 0.4)' : 'transparent',
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: selected ? `3px solid ${BLUE}` : autoEligible ? `3px solid ${GREEN}` : '3px solid transparent',
        transition: 'background-color 0.1s',
        cursor: onRowClick ? 'pointer' : 'default',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {/* Checkbox */}
      {selectable && (
        <div
          onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
          style={{
            width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: 'pointer',
            border: `1.5px solid ${selected ? BLUE : BORDER}`,
            backgroundColor: selected ? BLUE : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'border-color 0.1s, background-color 0.1s',
          }}
        >
          {selected && <div style={{ width: 6, height: 4, borderLeft: '1.5px solid #fff', borderBottom: '1.5px solid #fff', transform: 'rotate(-45deg)', marginTop: -1 }} />}
        </div>
      )}
      {/* Left accent strip */}
      <div style={{ width: 3, height: 26, borderRadius: 2, backgroundColor: card.headerColor, flexShrink: 0 }} />

      {/* DocBadge */}
      <DocBadge code={card.docCode} size="sm" />

      {/* Doc type + number */}
      <div style={{ width: 160, flexShrink: 0, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.docType}
          </span>
          {card.isGenerated && <Sparkles size={10} style={{ color: GOLD, flexShrink: 0 }} />}
        </div>
        <span className="vs-mono" style={{ fontSize: 10, color: MUTED, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.docNumber}
        </span>
      </div>

      {/* Issuer */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {card.issuer}
        </span>
        <span className="vs-mono" style={{ fontSize: 10, color: MUTED, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>
          {card.context}
        </span>
      </div>

      {/* Mini pipeline */}
      <div style={{ flexShrink: 0 }}>
        <MiniPipeline dots={card.dots} gold={card.goldDots} />
      </div>

      {/* Confidence pill + auto badge */}
      <div style={{ flexShrink: 0, width: 118, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Confident score
        </span>
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
          backgroundColor: `${confColor}15`, color: confColor,
        }}>
          {confText}
        </span>
        {autoEligible && (
          <span style={{ fontSize: 8.5, fontWeight: 700, color: GREEN, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Zap size={7} /> auto
          </span>
        )}
      </div>

      {/* Status pill */}
      <div style={{ flexShrink: 0, width: 122, textAlign: 'right' }}>
        {card.statusVariant === 'info' ? (
          <span style={{ fontSize: 10.5, fontWeight: 500, padding: '2px 8px', borderRadius: 999, backgroundColor: 'hsla(221,83%,53%,0.12)', color: BLUE }}>
            {card.status}
          </span>
        ) : card.statusVariant === 'validated' ? (
          <span style={{ fontSize: 10.5, fontWeight: 500, padding: '2px 8px', borderRadius: 999, backgroundColor: GOLD_BG, color: 'hsl(38 92% 30%)' }}>
            {card.status}
          </span>
        ) : (
          <StatusPill status={card.status} variant={card.statusVariant} />
        )}
      </div>

      {/* Action button */}
      <div style={{ flexShrink: 0, width: 150, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {card.canReExtract && (
          <button
            onClick={(e) => { e.stopPropagation(); onReExtractClick?.(); }}
            disabled={retrying}
            style={{
              fontSize: 11, fontWeight: 600, color: FG,
              backgroundColor: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 5,
              padding: '3px 8px', cursor: retrying ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 3, opacity: retrying ? 0.65 : 1,
            }}
          >
            <RotateCw size={10} style={retrying ? { animation: 'spin 0.8s linear infinite' } : undefined} />
            Retry
          </button>
        )}
        {card.action && (
          card.action.label === 'Approve extraction →' ? (
            <button
              onClick={(e) => { e.stopPropagation(); (onApproveClick ?? card.action?.onClick)?.(); }}
              style={{
                fontSize: 11, fontWeight: 600, color: '#fff',
                backgroundColor: BLUE, border: 'none', borderRadius: 5,
                padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Approve
            </button>
          ) : card.action.teal ? (
            <button
              onClick={(e) => { e.stopPropagation(); card.action?.href ? navigate(card.action.href) : card.action?.onClick?.(); }}
              style={{
                fontSize: 11, fontWeight: 600, color: '#fff',
                backgroundColor: TEAL, border: 'none', borderRadius: 5,
                padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Sparkles size={9} /> Review
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onRowClick?.(); }}
              style={{
                fontSize: 11, color: TEAL, background: 'none',
                border: `1px solid ${TEAL}40`, borderRadius: 5,
                padding: '3px 8px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              Details <ArrowRight size={10} />
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ─── Virtual list wrapper ─────────────────────────────────────────────────────
function VirtualList({
  cards,
  onApproveClick,
  onReExtractClick,
  onRowClick,
  selectedIds,
  onSelectToggle,
  autoEligibleIds,
  retryingId,
  selectable,
}: {
  cards: QueueCard[];
  onApproveClick: (card: QueueCard) => (() => void) | undefined;
  onReExtractClick: (card: QueueCard) => (() => void) | undefined;
  onRowClick: (card: QueueCard) => void;
  selectedIds: Set<string>;
  onSelectToggle: (id: string) => void;
  autoEligibleIds: Set<string>;
  retryingId: string | null;
  selectable: boolean;
}) {
  const ROW_H = 46;
  const scrollEl = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollEl.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  const totalHeight = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollEl}
      style={{ height: Math.min(totalHeight, ROW_H * 12), overflowY: 'auto' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const card = cards[vItem.index];
          const isSelectable = selectable && card.statusCategory === 'needs-approval';
          return (
            <QueueRowEl
              key={card.id}
              card={card}
              onApproveClick={onApproveClick(card)}
              onReExtractClick={onReExtractClick(card)}
              onRowClick={() => onRowClick(card)}
              selected={selectedIds.has(card.id)}
              selectable={isSelectable}
              onSelect={() => onSelectToggle(card.id)}
              autoEligible={autoEligibleIds.has(card.id)}
              retrying={retryingId === card.docId}
              style={{
                position: 'absolute',
                top: vItem.start,
                left: 0,
                right: 0,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── API → QueueCard helpers ──────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)} days ago`;
}

function apiDocToQueueCard(d: DocumentRecord): QueueCard {
  const dt = d.docType.toUpperCase();
  let docCode = 'DR', color = BLUE;
  if (dt === 'SALES_INVOICE' || dt === 'SI') { docCode = 'SI'; color = GREEN; }
  else if ((dt === 'PACKING_LIST' || dt === 'PL' || dt === 'PACKING-LIST') && !dt.includes('OUTWARD')) { docCode = 'PL'; color = BLUE; }
  else if (dt === 'BILL_OF_LADING' || dt === 'BOL' || dt === 'BL') { docCode = 'BL'; color = BLUE; }
  else if (dt === 'SHIPPING_BILL' || dt === 'SB') { docCode = 'SB'; color = BLUE; }
  else if (dt === 'ISF' || dt.includes('IMPORTER_SECURITY')) { docCode = 'IS'; color = INFO; }
  else if ((dt === 'BOE' || dt.includes('BILL_OF_ENTRY')) && !dt.includes('DRAFT')) { docCode = 'BE'; color = INFO; }
  else if (dt.includes('CHA') || dt.includes('FREIGHT_FORWARDER')) { docCode = 'CH'; color = BLUE; }

  const conf = typeof d.ocrConfidence === 'number' ? d.ocrConfidence : null;
  const normalizedStatus = d.status.toUpperCase();
  const isExtracted = ['EXTRACTED', 'REVIEWED'].includes(normalizedStatus);
  const isApproved  = normalizedStatus === 'REVIEWED';
  const isProcessing = ['QUEUED', 'PROCESSING', 'REPROCESSING'].includes(normalizedStatus);
  const canReExtract = !isProcessing && normalizedStatus !== 'ARCHIVED';

  let statusCategory: StatusCategory, status: string, resolvedColor: string;
  let dots: DotState[], detail: React.ReactNode, action: QueueCard['action'];

  if (isApproved) {
    statusCategory = 'cross-validating'; status = d.status;
    resolvedColor = TEAL; dots = ['done', 'done', 'done', 'current', 'future'];
    detail = <span><span style={{ color: GREEN }}>status: {d.status}</span>{' · extraction ready for cross-validation'}</span>;
  } else if (isExtracted) {
    statusCategory = 'needs-approval'; status = d.status;
    resolvedColor = color; dots = ['done', 'done', 'current', 'future', 'future'];
    detail = `status: ${d.status} · extraction available for review`;
    action = { label: 'Approve extraction →', primary: true };
  } else if (isProcessing) {
    statusCategory = 'processing'; status = d.status;
    resolvedColor = INFO; dots = ['done', 'current-spin', 'future', 'future', 'future'];
    detail = `status: ${d.status} · OCR queue is processing this document`;
  } else {
    statusCategory = 'uploaded'; status = d.status;
    resolvedColor = AMBER; dots = ['done', 'future', 'future', 'future', 'future'];
    detail = `status: ${d.status} - OCR is not running. Re-extract to queue OCR again.`;
  }

  return {
    id: `live-${d.id}`,
    docId: d.id,
    document: d,
    headerColor: resolvedColor,
    docCode, docType: d.docType,
    issuer: d.bucket,
    docNumber: d.fileName,
    status, statusVariant: isApproved ? 'pending' : 'info',
    statusCategory, avgConfidence: conf, dots,
    detail, action, canReExtract,
    context: `id: ${d.id} · objectKey: ${d.objectKey}`,
    timestamp: timeAgo(d.createdAt),
  };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function UploadProcessPage() {
  const [, navigate]       = useLocation();
  const { toast }          = useToast();
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const [isDragOver,    setIsDragOver]    = useState(false);
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null);
  const [isUploading,   setIsUploading]   = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [docType,       setDocType]       = useState<DocType | 'auto'>('auto');
  const [classification, setClassification] = useState<DocumentClassificationResponse | null>(null);
  const [shipmentVal,   setShipmentVal]   = useState('');
  const [shipmentOpts,  setShipmentOpts]  = useState<{ id: string; label: string }[]>([]);
  const [activeChip,    setActiveChip]    = useState(0);
  const [liveDocs,      setLiveDocs]      = useState<QueueCard[]>([]);
  const [isApproving,   setIsApproving]   = useState(false);
  const [retryingId,    setRetryingId]    = useState<string | null>(null);

  const fetchLiveDocs = useCallback(() => {
    documentApi.list()
      .then(({ data }) => {
        const cards: QueueCard[] = data.map(apiDocToQueueCard);
        setLiveDocs(cards);
      })
      .catch(() => {
        setLiveDocs([]);
      });
  }, []);

  useEffect(() => {
    fetchLiveDocs();
    const interval = setInterval(fetchLiveDocs, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveDocs]);

  async function uploadSelectedFile(resolvedDocType: DocType, successDescription?: string) {
    if (!selectedFile) return;
    setIsUploading(true);
    const form = new FormData();
    form.append('file', selectedFile);
    form.append('docType', resolvedDocType);
    form.append('module', resolvedDocType.toLowerCase().replace(/_/g, '-'));
    try {
      await documentApi.upload(form);
      toast({ title: 'Uploaded successfully', description: successDescription ?? `${selectedFile.name} is queued for OCR processing.` });
      setSelectedFile(null);
      setClassification(null);
      fetchLiveDocs();
    } catch (err) {
      toast({ title: 'Upload failed', description: errorDescription(err, 'Unable to upload right now.'), variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  }

  async function runPageUpload() {
    if (!selectedFile || isUploading || isClassifying) return;
    if (docType !== 'auto') {
      await uploadSelectedFile(docType);
      return;
    }
    setIsClassifying(true);
    setClassification(null);
    const form = new FormData();
    form.append('file', selectedFile);
    try {
      const { data } = await documentApi.classify(form);
      setClassification(data);
      toast({
        title: 'Document type detected',
        description: `${selectedFile.name} looks like ${data.label}. Confirm to start OCR.`,
      });
    } catch (err) {
      toast({ title: 'Auto-detect failed', description: errorDescription(err, 'Unable to classify this document.'), variant: 'destructive' });
    } finally {
      setIsClassifying(false);
    }
  }

  async function confirmDetectedType() {
    if (!classification || !selectedFile || isUploading) return;
    await uploadSelectedFile(
      classification.docType,
      `${selectedFile.name} was confirmed as ${classification.label} and queued for OCR processing.`,
    );
  }

  function resetSelectedFile() {
    setSelectedFile(null);
    setClassification(null);
  }

  const [recentExpanded, setRecentExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'row'>(
    () => (localStorage.getItem('upload-queue-view') as 'card' | 'row' | null) ?? 'card',
  );
  const [selectedIds,      setSelectedIds]      = useState<Set<string>>(new Set());
  const [autoThreshold,    setAutoThreshold]    = useState(95);
  const [autoEnabled,      setAutoEnabled]      = useState(false);

  // ── Completed items ──
  const COMPLETED = liveDocs
    .filter((card) => card.statusCategory === 'done' || card.statusCategory === 'cross-validating')
    .slice(0, 12)
    .map((card) => ({
      code: card.docCode,
      label: card.docType,
      number: card.docNumber,
      checks: card.status,
      time: card.timestamp,
      generated: Boolean(card.isGenerated),
    }));

  function openApprovalPanel(card: QueueCard) {
    if (card.docId) {
      navigate(`/documents/upload/${card.docId}/approve`);
    }
  }

  async function handleReExtract(card: QueueCard) {
    if (!card.docId || retryingId) return;
    setRetryingId(card.docId);
    try {
      await documentApi.retry(card.docId);
      toast({ title: 'Re-extraction queued', description: `${card.docNumber} will be processed from the latest DB status.` });
      fetchLiveDocs();
    } catch (err) {
      toast({ title: 'Re-extraction failed', description: errorDescription(err, 'Unable to queue OCR retry.'), variant: 'destructive' });
    } finally {
      setRetryingId(null);
    }
  }

  // ── Bulk approve ────────────────────────────────────────────────────────────
  async function handleBulkApprove(ids: Set<string>) {
    if (isApproving) return;
    const docsToApprove = visibleCards.filter((card) => ids.has(card.id) && card.docId);
    if (!docsToApprove.length) return;
    const n = ids.size;
    setIsApproving(true);
    try {
      await Promise.all(docsToApprove.map((card) => documentApi.approve(card.docId!)));
      setSelectedIds(new Set());
      fetchLiveDocs();
      toast({ title: `${n} document${n === 1 ? '' : 's'} approved`, description: 'Database status updated.' });
    } catch (err) {
      toast({ title: 'Bulk approval failed', description: err instanceof Error ? err.message : 'Unable to approve selected documents.', variant: 'destructive' });
    } finally {
      setIsApproving(false);
    }
  }

  function handleSelectToggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleRowClick(card: QueueCard) {
    if (card.statusCategory === 'draft-review' && card.action?.href) {
      navigate(card.action.href);
      return;
    }
    if (card.docId) {
      navigate(`/documents/upload/${card.docId}`);
      return;
    }
  }

  // ── Derived stats & filter ──────────────────────────────────────────────────
  const visibleCards: QueueCard[] = liveDocs;

  const statsCount = {
    total:           visibleCards.length,
    needsApproval:   visibleCards.filter((c) => c.statusCategory === 'needs-approval').length,
    processing:      visibleCards.filter((c) => c.statusCategory === 'processing').length,
    crossValidating: visibleCards.filter((c) => c.statusCategory === 'cross-validating').length,
    draftReview:     visibleCards.filter((c) => c.statusCategory === 'draft-review').length,
    done:            visibleCards.filter((c) => c.statusCategory === 'done').length,
  };

  const CHIP_CATEGORIES: (StatusCategory | null)[] = [null, 'needs-approval', 'processing', 'cross-validating', 'draft-review', 'done'];
  const filteredCards = activeChip === 0
    ? visibleCards
    : visibleCards.filter((c) => c.statusCategory === CHIP_CATEGORIES[activeChip]);

  // Batch-select helpers
  const selectableFiltered = filteredCards.filter((c) => c.statusCategory === 'needs-approval');
  const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((c) => selectedIds.has(c.id));
  const someSelected = selectableFiltered.some((c) => selectedIds.has(c.id));

  // Auto-approve eligible: needs-approval AND confidence >= threshold
  const autoEligibleIds = new Set<string>(
    autoEnabled
      ? filteredCards
          .filter((c) => c.statusCategory === 'needs-approval' && c.avgConfidence !== null && c.avgConfidence >= autoThreshold / 100)
          .map((c) => c.id)
      : [],
  );

  // Auto-switch: >20 items → row, ≤20 → card
  const effectiveView: 'card' | 'row' = filteredCards.length > 20 ? 'row' : viewMode;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 'none' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <PageHeader
        title="Upload & Process"
        subtitle="Upload documents · OCR extract · Approve fields · Route to shipment"
      />

      {/* ── Two-column layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}
           className="grid-cols-1 lg:grid-cols-[280px_1fr]"
      >
        {/* ── LEFT: Upload Zone ── */}
        <div style={{ position: 'sticky', top: 88, alignSelf: 'start' }}>
          <div style={{
            backgroundColor: 'hsl(var(--card))', borderRadius: 12,
            padding: 20, boxShadow: 'var(--vs-shadow-card)', border: `1px solid ${BORDER}`,
          }}>
            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setIsDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) { setSelectedFile(f); setClassification(null); }
              }}
              style={{
                height: selectedFile ? 90 : 180, borderRadius: 12, cursor: 'pointer',
                border: `2px dashed ${isDragOver ? TEAL : selectedFile ? GREEN : BORDER}`,
                backgroundColor: isDragOver ? 'hsla(173,58%,39%,0.04)' : selectedFile ? 'hsla(152,69%,31%,0.04)' : 'hsl(var(--background))',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <UploadCloud size={selectedFile ? 20 : 36} style={{ color: selectedFile ? GREEN : MUTED }} />
              {selectedFile ? (
                <>
                  <span style={{ fontSize: 12, fontWeight: 600, color: GREEN }}>File ready</span>
                  <span style={{ fontSize: 11, color: MUTED, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.name}</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 14, fontWeight: 500, color: FG }}>Drop files here</span>
                  <span style={{ fontSize: 12, color: MUTED }}>or click to browse</span>
                  <span style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>.pdf · .jpg · .png</span>
                </>
              )}
            </div>
            {selectedFile && (
              <button
                onClick={(e) => { e.stopPropagation(); resetSelectedFile(); }}
                style={{ fontSize: 11, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: '2px 0' }}
              >
                ✕ Remove file
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.png"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setSelectedFile(f); setClassification(null); } e.target.value = ''; }}
            />

            {/* Document type selector */}
            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Document type
              </label>
              <select
                value={docType}
                onChange={(e) => { setDocType(e.target.value as DocType | 'auto'); setClassification(null); }}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 8,
                  border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))',
                  fontSize: 13, color: FG, cursor: 'pointer',
                }}
              >
                {Array.from(new Set(DOC_TYPE_SELECT_OPTIONS.map((option) => option.group ?? 'Documents'))).map((group) => (
                  <optgroup key={group} label={group}>
                    {DOC_TYPE_SELECT_OPTIONS
                      .filter((option) => (option.group ?? 'Documents') === group)
                      .map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <p style={{ fontSize: 11, color: MUTED, margin: '5px 0 0' }}>
                Auto-detect classifies the document first and asks for confirmation before OCR.
              </p>
            </div>

            {classification && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: 'hsl(var(--muted) / 0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Detected document</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: FG, marginTop: 2 }}>{classification.label}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: TEAL }}>
                    {Math.round(classification.confidence * 100)}%
                  </div>
                </div>
                {classification.matchedFields.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {classification.matchedFields.slice(0, 5).map((field) => (
                      <span key={field} style={{ fontSize: 10, color: FG, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '2px 7px', background: 'hsl(var(--background))' }}>{field}</span>
                    ))}
                  </div>
                )}
                {classification.alternatives.length > 0 && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                    Alternative: {labelForDocType(String(classification.alternatives[0]?.docType ?? ''))}
                  </div>
                )}
              </div>
            )}

            {/* Shipment selector */}
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Assign to shipment
              </label>
              <select
                value={shipmentVal}
                onChange={(e) => setShipmentVal(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 8,
                  border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))',
                  fontSize: 12, color: FG, cursor: 'pointer',
                }}
              >
                <option value="">Auto-match after OCR</option>
                {shipmentOpts.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: MUTED, margin: '5px 0 0' }}>
                System will match using invoice/BOL numbers
              </p>
            </div>

            {/* Submit button */}
            <button
              onClick={runPageUpload}
              disabled={!selectedFile || isUploading || isClassifying || Boolean(classification)}
              style={{
                marginTop: 14, width: '100%', padding: '9px 14px', borderRadius: 8,
                border: 'none', cursor: selectedFile && !isUploading && !isClassifying && !classification ? 'pointer' : 'not-allowed',
                backgroundColor: selectedFile && !isUploading && !isClassifying && !classification ? TEAL : BORDER,
                color: selectedFile && !isUploading && !isClassifying && !classification ? '#fff' : MUTED,
                fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6, transition: 'background-color 0.15s',
              }}
            >
              {isUploading || isClassifying ? (
                <>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #fff4', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  {isClassifying ? 'Detecting…' : 'Uploading…'}
                </>
              ) : (
                <>
                  <UploadCloud size={14} />
                  {selectedFile ? (docType === 'auto' ? 'Auto-detect document' : 'Upload & Process') : 'Select a file first'}
                </>
              )}
            </button>
            {classification && (
              <button
                onClick={confirmDetectedType}
                disabled={isUploading}
                style={{
                  marginTop: 8, width: '100%', padding: '9px 14px', borderRadius: 8,
                  border: 'none', cursor: !isUploading ? 'pointer' : 'not-allowed',
                  backgroundColor: !isUploading ? TEAL : BORDER,
                  color: !isUploading ? '#fff' : MUTED,
                  fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 6,
                }}
              >
                <CheckCircle2 size={14} />
                Confirm & extract as {classification.label}
              </button>
            )}

            {/* API Pull */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: FG, margin: '0 0 8px' }}>
                Or pull from source
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { icon: FolderOpen, label: 'Pull from shared folder' },
                  { icon: Database,   label: 'Pull from accounting system' },
                ].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => toast({ title: 'Integration not configured', description: `${label} integration is coming soon. Contact your administrator to enable it.` })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 12px', borderRadius: 8,
                      border: `1px solid ${BORDER}`, backgroundColor: 'transparent',
                      fontSize: 12, color: FG, cursor: 'pointer', fontWeight: 500,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = TEAL; (e.currentTarget as HTMLButtonElement).style.color = TEAL; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; (e.currentTarget as HTMLButtonElement).style.color = FG; }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent uploads */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: FG, margin: '0 0 8px' }}>
                Recent
              </p>
              {liveDocs.slice(0, 4).length ? liveDocs.slice(0, 4).map((item) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <DocBadge code={item.docCode} size="sm" />
                  <span style={{ fontSize: 11, color: FG, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.docNumber}</span>
                  {item.isGenerated && <Sparkles size={10} style={{ color: GOLD }} />}
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: item.statusCategory === 'processing' ? AMBER : GREEN, flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, color: MUTED, flexShrink: 0 }}>{item.timestamp}</span>
                </div>
              )) : (
                <div style={{ fontSize: 11, color: MUTED }}>No DB documents uploaded yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Processing Queue ── */}
        <div>

          {/* ── Stats strip ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
            flexWrap: 'wrap',
          }}>
            {[
              { label: 'Total',           count: statsCount.total,           color: FG,    bg: 'hsl(var(--muted))',           idx: 0 },
              { label: 'Needs approval',  count: statsCount.needsApproval,   color: BLUE,  bg: 'hsla(221,83%,53%,0.10)',      idx: 1 },
              { label: 'Processing',      count: statsCount.processing,      color: INFO,  bg: 'hsla(201,96%,32%,0.10)',      idx: 2 },
              { label: 'Cross-validating',count: statsCount.crossValidating, color: TEAL,  bg: 'hsla(173,58%,39%,0.10)',      idx: 3 },
              { label: 'Draft review',    count: statsCount.draftReview,     color: 'hsl(38 92% 30%)', bg: GOLD_BG,           idx: 4 },
              { label: 'Done',            count: statsCount.done,            color: GREEN, bg: `${GREEN}12`,                  idx: 5 },
            ].map(({ label, count, color, bg, idx }) => (
              <button
                key={label}
                onClick={() => setActiveChip(idx)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                  border: `1.5px solid ${activeChip === idx ? color : 'transparent'}`,
                  backgroundColor: activeChip === idx ? bg : 'hsl(var(--muted))',
                  transition: 'border-color 0.12s, background-color 0.12s',
                }}
              >
                <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color }}>
                  {count}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, color: activeChip === idx ? color : MUTED, whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* ── Queue header: title + filter chips + density toggle ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: FG }}>Processing queue</span>
              <span style={{ fontSize: 12, color: MUTED }}>
                {filteredCards.length} {activeChip !== 0 ? 'filtered' : 'total'}
              </span>
              {filteredCards.length > 20 && (
                <span style={{
                  fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                  backgroundColor: `${TEAL}15`, color: TEAL,
                }}>
                  Auto row view
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FilterChips
                chips={[
                  { label: 'All',              count: statsCount.total },
                  { label: 'Needs approval',   count: statsCount.needsApproval },
                  { label: 'Processing',       count: statsCount.processing },
                  { label: 'Cross-validating', count: statsCount.crossValidating },
                  { label: 'Draft review',     count: statsCount.draftReview },
                  { label: 'Done',             count: statsCount.done },
                ]}
                activeIndex={activeChip}
                onSelect={setActiveChip}
              />
              {/* Density toggle — only shown when ≤20 items */}
              {filteredCards.length <= 20 && (
                <div style={{
                  display: 'flex', border: `1px solid ${BORDER}`, borderRadius: 7, overflow: 'hidden', flexShrink: 0,
                }}>
                  {(['card', 'row'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => { setViewMode(mode); localStorage.setItem('upload-queue-view', mode); }}
                      title={mode === 'card' ? 'Card view' : 'Row view'}
                      style={{
                        padding: '5px 9px', cursor: 'pointer', border: 'none',
                        backgroundColor: viewMode === mode ? TEAL : 'transparent',
                        color: viewMode === mode ? '#fff' : MUTED,
                        display: 'flex', alignItems: 'center',
                        transition: 'background-color 0.12s',
                      }}
                    >
                      {mode === 'card' ? <LayoutGrid size={14} /> : <LayoutList size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Auto-approve threshold bar ── */}
          {statsCount.needsApproval > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', marginBottom: 10, borderRadius: 8,
              backgroundColor: autoEnabled ? `${GREEN}0d` : 'hsl(var(--muted) / 0.5)',
              border: `1px solid ${autoEnabled ? `${GREEN}30` : BORDER}`,
              transition: 'background-color 0.15s, border-color 0.15s',
            }}>
              <SlidersHorizontal size={13} style={{ color: autoEnabled ? GREEN : MUTED, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: autoEnabled ? GREEN : MUTED, fontWeight: 600, flexShrink: 0 }}>
                Auto-approve
              </span>
              {/* Toggle */}
              <div
                onClick={() => setAutoEnabled((v) => !v)}
                style={{
                  width: 30, height: 16, borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                  backgroundColor: autoEnabled ? GREEN : 'hsl(var(--border))',
                  position: 'relative', transition: 'background-color 0.15s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 2,
                  left: autoEnabled ? 16 : 2,
                  width: 12, height: 12, borderRadius: '50%',
                  backgroundColor: '#fff',
                  transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
              {/* Threshold slider */}
              <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>≥</span>
              <input
                type="range" min={80} max={100} step={1}
                value={autoThreshold}
                onChange={(e) => setAutoThreshold(Number(e.target.value))}
                disabled={!autoEnabled}
                style={{ width: 80, accentColor: GREEN, opacity: autoEnabled ? 1 : 0.4, cursor: autoEnabled ? 'pointer' : 'default' }}
              />
              <span style={{
                fontSize: 11.5, fontWeight: 700, minWidth: 30,
                color: autoEnabled ? GREEN : MUTED,
              }}>
                {autoThreshold}%
              </span>
              {/* Eligible count badge */}
              {autoEnabled && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999,
                  backgroundColor: autoEligibleIds.size > 0 ? `${GREEN}18` : 'hsl(var(--muted))',
                  color: autoEligibleIds.size > 0 ? GREEN : MUTED,
                }}>
                  {autoEligibleIds.size} eligible
                </span>
              )}
              <div style={{ flex: 1 }} />
              {/* Auto-approve button */}
              {autoEnabled && autoEligibleIds.size > 0 && (
                <button
                  onClick={() => handleBulkApprove(autoEligibleIds)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 11.5, fontWeight: 700, color: '#fff',
                    backgroundColor: GREEN, border: 'none', borderRadius: 6,
                    padding: '5px 12px', cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <Zap size={11} />
                  Auto-approve {autoEligibleIds.size}
                </button>
              )}
            </div>
          )}

          {/* ── Queue content (relative wrapper for bulk bar) ── */}
          <div style={{ position: 'relative' }}>
          {effectiveView === 'card' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredCards.map((card) => {
                const isSelectable = card.statusCategory === 'needs-approval';
                return (
                  <QueueCardEl
                    key={card.id}
                    card={card}
                    onApproveClick={card.statusCategory === 'needs-approval' ? () => openApprovalPanel(card) : undefined}
                    onReExtractClick={card.canReExtract ? () => handleReExtract(card) : undefined}
                    onCardClick={() => handleRowClick(card)}
                    selected={selectedIds.has(card.id)}
                    selectable={isSelectable}
                    onSelect={() => handleSelectToggle(card.id)}
                    autoEligible={autoEligibleIds.has(card.id)}
                    retrying={retryingId === card.docId}
                  />
                );
              })}
            </div>
          ) : (
            /* Row view with virtual scroll */
            <div style={{
              backgroundColor: 'hsl(var(--card))', borderRadius: 12,
              border: `1px solid ${BORDER}`, overflow: 'hidden',
            }}>
              {/* Column headers */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0 14px', height: 34,
                backgroundColor: 'hsl(var(--muted) / 0.5)',
                borderBottom: `1px solid ${BORDER}`,
              }}>
                {/* Select-all checkbox */}
                {selectableFiltered.length > 0 && (
                  <div
                    onClick={() => {
                      if (allSelected) {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          selectableFiltered.forEach((c) => next.delete(c.id));
                          return next;
                        });
                      } else {
                        setSelectedIds((prev) => new Set([...prev, ...selectableFiltered.map((c) => c.id)]));
                      }
                    }}
                    title={allSelected ? 'Deselect all' : 'Select all needs-approval'}
                    style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: 'pointer',
                      border: `1.5px solid ${someSelected ? BLUE : BORDER}`,
                      backgroundColor: allSelected ? BLUE : someSelected ? `${BLUE}30` : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {allSelected && <div style={{ width: 6, height: 4, borderLeft: '1.5px solid #fff', borderBottom: '1.5px solid #fff', transform: 'rotate(-45deg)', marginTop: -1 }} />}
                    {someSelected && !allSelected && <div style={{ width: 6, height: 1.5, backgroundColor: BLUE }} />}
                  </div>
                )}
                {selectableFiltered.length === 0 && <div style={{ width: 14, flexShrink: 0 }} />}
                <div style={{ width: 3, flexShrink: 0 }} />
                <div style={{ width: 24, flexShrink: 0 }} />
                <div style={{ width: 160, flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Document</div>
                <div style={{ flex: 1, fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Issuer / Context</div>
                <div style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pipeline</div>
                <div style={{ flexShrink: 0, width: 118, textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Confident score</div>
                <div style={{ flexShrink: 0, width: 122, textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</div>
                <div style={{ flexShrink: 0, width: 150 }} />
              </div>
              {/* Virtual list */}
              <VirtualList
                cards={filteredCards}
                onApproveClick={(card) => card.statusCategory === 'needs-approval' ? () => openApprovalPanel(card) : undefined}
                onReExtractClick={(card) => card.canReExtract ? () => handleReExtract(card) : undefined}
                onRowClick={handleRowClick}
                selectedIds={selectedIds}
                onSelectToggle={handleSelectToggle}
                autoEligibleIds={autoEligibleIds}
                retryingId={retryingId}
                selectable={selectableFiltered.length > 0}
              />
            </div>
          )}

          {/* ── Floating bulk action bar ── */}
          {selectedIds.size > 0 && (
            <div style={{
              position: 'sticky', bottom: 16, zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px', borderRadius: 10, marginTop: 10,
              backgroundColor: 'hsl(var(--card))',
              border: `1.5px solid ${BLUE}`,
              boxShadow: `0 4px 20px hsla(221,83%,53%,0.18), 0 1px 6px rgba(0,0,0,0.12)`,
              animation: 'slideUp 0.18s ease',
            }}>
              <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                backgroundColor: BLUE, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {selectedIds.size}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: FG }}>
                {selectedIds.size} document{selectedIds.size === 1 ? '' : 's'} selected
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{
                  fontSize: 11.5, color: MUTED, background: 'none',
                  border: `1px solid ${BORDER}`, borderRadius: 6,
                  padding: '5px 12px', cursor: 'pointer',
                }}
              >
                Deselect all
              </button>
              <button
                onClick={() => handleBulkApprove(new Set([...selectedIds].filter((id) => {
                  const c = visibleCards.find((v) => v.id === id);
                  return c?.statusCategory === 'needs-approval';
                })))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 700, color: '#fff',
                  backgroundColor: BLUE, border: 'none', borderRadius: 6,
                  padding: '6px 14px', cursor: 'pointer',
                }}
              >
                <CheckCircle2 size={13} />
                Approve {selectedIds.size} selected
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* ── Recently Completed Strip ── */}
      <div style={{ marginTop: 32, borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
        <button
          onClick={() => setRecentExpanded(!recentExpanded)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            width: '100%', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: FG }}>
            Recently completed (last 24 hours)
          </span>
          <span style={{ fontSize: 12, color: MUTED }}>{COMPLETED.length} documents</span>
          <div style={{ marginLeft: 'auto' }}>
            {recentExpanded
              ? <ChevronDown size={16} color={MUTED} />
              : <ChevronRight size={16} color={MUTED} />}
          </div>
        </button>

        {recentExpanded && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12,
          }}
               className="grid-cols-1 md:grid-cols-3"
          >
            {COMPLETED.map((item, i) => (
              <div key={i} style={{
                backgroundColor: 'hsl(var(--card))', borderRadius: 8,
                padding: '10px 14px', border: `1px solid ${BORDER}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <DocBadge code={item.code} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </span>
                    {item.generated && <Sparkles size={10} style={{ color: GOLD, flexShrink: 0 }} />}
                  </div>
                  <span className="vs-mono" style={{ fontSize: 10.5, color: MUTED, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.number}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <CheckCircle2 size={10} style={{ color: GREEN }} />
                    <span style={{ fontSize: 11, color: GREEN }}>{item.checks}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{item.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
