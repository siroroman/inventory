import { randomUUID } from 'node:crypto';
import type { Db } from './db/client.ts';
import { transactor } from './db/transaction.ts';
import { auditRepos, createAuditService } from './modules/audit/service.ts';
import { createItemService, itemRepos } from './modules/items/service.ts';
import {
  createLocationService,
  createLocationTypeService,
  locationRepos,
} from './modules/locations/service.ts';
import { createManufacturerService, manufacturerRepos } from './modules/manufacturers/service.ts';
import { createPhotoService, photoRepos } from './modules/photos/service.ts';
import type { PhotoStorage } from './modules/photos/storage.ts';
import { createServiceProviderService, serviceProviderRepos } from './modules/service-providers/service.ts';
import { createUserService, type UserInvites, userRepos } from './modules/users/service.ts';

/**
 * The composition root: every service, wired to one database. Routes receive this (through
 * `createApp`) instead of building services themselves, so tests can build the app against a
 * throwaway database.
 */
export function createServices({ db, storage, invites }: { db: Db; storage: PhotoStorage; invites: UserInvites }) {
  return {
    locations: createLocationService({ repos: locationRepos(db), transact: transactor(db, locationRepos) }),
    locationTypes: createLocationTypeService({ repos: locationRepos(db), transact: transactor(db, locationRepos) }),
    items: createItemService({ repos: itemRepos(db), transact: transactor(db, itemRepos) }),
    manufacturers: createManufacturerService({
      repos: manufacturerRepos(db),
      transact: transactor(db, manufacturerRepos),
    }),
    serviceProviders: createServiceProviderService({
      repos: serviceProviderRepos(db),
      transact: transactor(db, serviceProviderRepos),
    }),
    photos: createPhotoService({
      repos: photoRepos(db),
      transact: transactor(db, photoRepos),
      storage,
      newId: randomUUID,
    }),
    users: createUserService({ repos: userRepos(db), transact: transactor(db, userRepos), invites }),
    audit: createAuditService({ repos: auditRepos(db) }),
  };
}

export type Services = ReturnType<typeof createServices>;
