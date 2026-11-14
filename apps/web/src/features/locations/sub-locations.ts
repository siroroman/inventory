import type { LocationDto } from '@inventory/shared';

/**
 * Whether the screens speak of sub-locations for this location: where its type allows them (the
 * headquarters, a site), or where some exist anyway (it has children, or is itself a sub-location),
 * so nothing already entered is hidden. A shop is one place and shows none.
 */
export const hasSubLocations = (location: Pick<LocationDto, 'allowsSubLocations' | 'childCount' | 'parentId'>) =>
  location.allowsSubLocations || location.childCount > 0 || location.parentId !== null;
