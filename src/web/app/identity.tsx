import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  dataHealthQueryKey,
  demoStatusQueryKey,
  getDataHealth,
  getDemoStatus,
} from '../data/demo.js';

export const DEMO_IDENTITIES = [
  { id: 'user_viewer', label: 'Viewer', initials: 'VW' },
  { id: 'user_investigator', label: 'Investigator / Case Manager', initials: 'IN' },
  { id: 'user_approver', label: 'Finance Approver', initials: 'FA' },
  { id: 'user_operator', label: 'Demo Operator / Auditor', initials: 'DO' },
] as const;

export type DemoIdentity = (typeof DEMO_IDENTITIES)[number];

interface IdentityContextValue {
  readonly identity: DemoIdentity;
  readonly isSwitching: boolean;
  readonly switchingTo: DemoIdentity | null;
  readonly announcement: string;
  readonly switchIdentity: (id: DemoIdentity['id']) => Promise<void>;
  readonly announce: (message: string) => void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<DemoIdentity>(DEMO_IDENTITIES[0]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<DemoIdentity | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const switchIdentity = useCallback(
    async (id: DemoIdentity['id']) => {
      const next = DEMO_IDENTITIES.find((candidate) => candidate.id === id);
      if (!next || next.id === identity.id || isSwitching) return;
      setSwitchingTo(next);
      setIsSwitching(true);
      await queryClient.cancelQueries();
      queryClient.clear();
      const controller = new AbortController();
      const [statusResult, healthResult] = await Promise.allSettled([
        getDemoStatus(next.id, controller.signal),
        getDataHealth(next.id, controller.signal),
      ]);
      if (statusResult.status === 'fulfilled') {
        queryClient.setQueryData(demoStatusQueryKey(next.id), statusResult.value);
      }
      if (healthResult.status === 'fulfilled') {
        queryClient.setQueryData(dataHealthQueryKey(next.id), healthResult.value);
      }
      setIdentity(next);
      setAnnouncement(`Demo role changed to ${next.label}`);
      setSwitchingTo(null);
      setIsSwitching(false);
    },
    [identity.id, isSwitching, queryClient],
  );

  const value = useMemo(
    () => ({ identity, isSwitching, switchingTo, announcement, switchIdentity, announce }),
    [announce, announcement, identity, isSwitching, switchingTo, switchIdentity],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (!value) throw new Error('useIdentity must be used within IdentityProvider');
  return value;
}
