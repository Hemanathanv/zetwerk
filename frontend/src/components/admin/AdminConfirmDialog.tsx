import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdminConfirmDialogProps {
  open: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'warning';
  requireTypedConfirmation?: string;
}

export function AdminConfirmDialog({
  open, onClose, onCancel, onConfirm,
  title, description,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  requireTypedConfirmation,
}: AdminConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const confirmed = !requireTypedConfirmation || typed === requireTypedConfirmation;

  function handleClose() {
    setTyped('');
    (onClose ?? onCancel)?.();
  }

  function handleConfirm() {
    if (!confirmed) return;
    setTyped('');
    onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent style={{ maxWidth: 440, padding: 24 }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            {title}
          </DialogTitle>
          <DialogDescription style={{ fontSize: 14.5, lineHeight: 1.6 }}>
            {description}
          </DialogDescription>
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
            variant={confirmVariant === 'danger' ? 'danger' : 'default'}
            disabled={!confirmed}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
