import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCanUseYalla } from './yalla-access';

/** Sends anyone who may not use YALLA back to the dashboard. */
export function RequireYalla({ children }: { children: ReactNode }) {
  return useCanUseYalla() ? <>{children}</> : <Navigate to="/" replace />;
}
