import { roleAtLeast } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { meQueryOptions } from './api';

/**
 * Whether the signed-in user may create and edit. Only decides what the screens show: the API
 * checks the role on every write. The session is already cached by the route guard.
 */
export function useCanWrite(): boolean {
  const { data } = useQuery(meQueryOptions);
  return data !== undefined && roleAtLeast(data.role, 'write');
}
