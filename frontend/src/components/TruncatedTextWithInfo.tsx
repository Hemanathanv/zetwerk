import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type TruncatedTextWithInfoProps = {
  text: string;
  /** Styles applied to the truncating text element */
  textStyle?: CSSProperties;
  /** Styles applied to the outer flex wrapper */
  style?: CSSProperties;
  /** Extra className on the truncating text element */
  textClassName?: string;
  /** Tooltip side */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional prefix/icon rendered before the text */
  leading?: ReactNode;
  /** Stop click propagation on the info button (useful inside clickable rows) */
  stopInfoClickPropagation?: boolean;
};

/**
 * Renders single-line truncated text. When the text is actually overflowing,
 * shows an info icon whose tooltip contains the full string. When not truncated,
 * the info icon is hidden.
 */
export function TruncatedTextWithInfo({
  text,
  textStyle,
  style,
  textClassName,
  side = 'top',
  leading,
  stopInfoClickPropagation = true,
}: TruncatedTextWithInfoProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const fullText = String(text ?? '');

  useEffect(() => {
    const el = textRef.current;
    if (!el) {
      setTruncated(false);
      return;
    }

    const measure = () => {
      setTruncated(el.scrollWidth > el.clientWidth + 1);
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fullText]);

  if (!fullText) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%', ...style }}>
      {leading}
      <span
        ref={textRef}
        className={textClassName}
        title={truncated ? undefined : fullText}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
          ...textStyle,
        }}
      >
        {fullText}
      </span>
      {truncated && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Show full text"
              onClick={(event) => {
                if (stopInfoClickPropagation) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              style={{
                width: 18,
                height: 18,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--card))',
                color: 'hsl(var(--muted-foreground))',
                cursor: 'help',
                padding: 0,
              }}
            >
              <Info size={11} />
            </button>
          </TooltipTrigger>
          <TooltipContent side={side} className="max-w-xs text-[12px] leading-relaxed break-words">
            {fullText}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
