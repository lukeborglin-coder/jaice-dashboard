import React from 'react';

interface MappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  mappingData: any;
  onSave: (mapping: Record<string, string>) => void;
  columnHeaders: string[];
}

export const MappingModal: React.FC<MappingModalProps> = ({
  isOpen,
  onClose,
  mappingData,
  onSave,
  columnHeaders,
}) => {
  // Component implementation will be extracted from Tabs.tsx
  if (!isOpen) return null;
  return <div>MappingModal - To be implemented</div>;
};

