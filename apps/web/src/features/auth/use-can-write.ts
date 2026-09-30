import { useQuery } from '@tanstack/react-query';
import { meQueryOptions } from './api';

/**
 * Whether the signed-in user may create and edit (`write` or `admin`). This only decides which
 * buttons to show; the API enforces the role.
 */
export function useCanWrite(): boolean {
  const role = useQuery(meQueryOptions).data?.role;
  return role === 'write' || role === 'admin';
}
