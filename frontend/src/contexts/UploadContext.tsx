import { createContext, useContext, useState } from 'react';

export type UploadDefaults = {
  shipmentId?: string;
  docType?: string;
};

interface UploadContextValue {
  open: boolean;
  defaults: UploadDefaults | null;
  openUpload: () => void;
  openUploadWith: (defaults: UploadDefaults) => void;
  closeUpload: () => void;
}

const UploadContext = createContext<UploadContextValue>({
  open: false,
  defaults: null,
  openUpload: () => {},
  openUploadWith: () => {},
  closeUpload: () => {},
});

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<UploadDefaults | null>(null);

  function openUpload() {
    setDefaults(null);
    setOpen(true);
  }

  function openUploadWith(nextDefaults: UploadDefaults) {
    setDefaults(nextDefaults);
    setOpen(true);
  }

  function closeUpload() {
    setOpen(false);
  }

  return (
    <UploadContext.Provider value={{ open, defaults, openUpload, openUploadWith, closeUpload }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
