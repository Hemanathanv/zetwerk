import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdminConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'warning';
  requireTypedConfirmation?: string;
}

export function AdminConfirmDialog({
  open, onClose, onConfirm,
  title, description,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  requireTypedConfirmation,
}: AdminConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const confirmed = !requireTypedConfirmation || typed === requireTypedConfirmation;

  function handleClose() {
    setTyped('');
    onClose();
  }

  function handleConfirm() {
    if (!confirmed) return;
    setTyped('');
    onConfirm();
  }

  const iconColor = confirmVariant === 'danger' ? '#dc2626' : '#d97706';
  const btnBg = confirmVariant === 'danger'
    ? 'hsl(0 72% 51%)'
    : 'hsl(38 92% 50%)';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent style={{ maxWidth: 440, padding: '28px 28px 24px' }}>
        <DialogHeader>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <AlertTriangle size={32} color={iconColor} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <DialogTitle style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                {title}
              </DialogTitle>
              <DialogDescription style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {requireTypedConfirmation && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 6 }}>
              Type <strong>{requireTypedConfirmation}</strong> to confirm
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTypedConfirmation}
              style={{ fontSize: 14.5 }}
            />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 24,
          }}
        >
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!confirmed}
            onClick={handleConfirm}
            style={{
              background: confirmed ? btnBg : undefined,
              borderColor: confirmed ? btnBg : undefined,
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
