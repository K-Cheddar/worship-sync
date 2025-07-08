import React, { createContext, useContext, useState, ReactNode } from "react";

interface VersionUpdate {
  newVersion: string;
  currentVersion: string;
  timestamp: number;
}

interface VersionContextType {
  versionUpdate: VersionUpdate | null;
  setVersionUpdate: (update: VersionUpdate | null) => void;
  showUpdateModal: boolean;
  setShowUpdateModal: (show: boolean) => void;
  isUpdating: boolean;
  setIsUpdating: (updating: boolean) => void;
  changelog: string | null;
  setChangelog: (changelog: string | null) => void;
  isLoadingChangelog: boolean;
  setIsLoadingChangelog: (loading: boolean) => void;
}

const VersionContext = createContext<VersionContextType | undefined>(undefined);

export const useVersionContext = () => {
  const context = useContext(VersionContext);
  if (context === undefined) {
    throw new Error("useVersionContext must be used within a VersionProvider");
  }
  return context;
};

interface VersionProviderProps {
  children: ReactNode;
}

export const VersionProvider: React.FC<VersionProviderProps> = ({
  children,
}) => {
  const [versionUpdate, setVersionUpdate] = useState<VersionUpdate | null>(
    null
  );
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);

  const value = {
    versionUpdate,
    setVersionUpdate,
    showUpdateModal,
    setShowUpdateModal,
    isUpdating,
    setIsUpdating,
    changelog,
    setChangelog,
    isLoadingChangelog,
    setIsLoadingChangelog,
  };

  return (
    <VersionContext.Provider value={value}>{children}</VersionContext.Provider>
  );
};
