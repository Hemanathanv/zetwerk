import { createContext, useContext, useState } from 'react';

interface UploadContextValue {
  open: boolean;
  openUpload: () => void;
  closeUpload: () => void;
}

const UploadContext = createContext<UploadContextValue>({
  open: false,
  openUpload: () => {},
  closeUpload: () => {},
});

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <UploadContext.Provider value={{ open, openUpload: () => setOpen(true), closeUpload: () => setOpen(false) }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
