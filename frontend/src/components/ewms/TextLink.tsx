import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type TextLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  trailingIcon?: ReactNode;
};

export function TextLink({ className, children, trailingIcon, ...props }: TextLinkProps) {
  return (
    <a
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {children}
      {trailingIcon ?? <ArrowRight className="size-3.5" aria-hidden="true" />}
    </a>
  );
}
