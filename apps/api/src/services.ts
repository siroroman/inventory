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
import { createServiceProviderService, serviceProviderRepos } from './modules/service-providers/service.ts';

/**
 * The composition root: every service, wired to one database. Routes receive this (through
 * `createApp`) instead of building services themselves, so tests can build the app against a
 * throwaway database. Photo and user services join when their ports (storage, invites) exist.
 */
export function createServices({ db }: { db: Db }) {
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
    audit: createAuditService({ repos: auditRepos(db) }),
  };
}

export type Services = ReturnType<typeof createServices>;
