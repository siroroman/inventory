import { asc, count, eq } from 'drizzle-orm';
import { createItemRepository } from '../../modules/items/repository.ts';
import {
  createLocationRepository,
  createLocationTypeRepository,
} from '../../modules/locations/repository.ts';
import { createManufacturerRepository } from '../../modules/manufacturers/repository.ts';
import type { Db } from '../client.ts';
import { items, locations, manufacturers, user } from '../schema/index.ts';

/** The bulk data is already there (or the database holds real amounts of data); it is added only once. */
export class BulkSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkSeedRefusedError';
  }
}

export type BulkSeedOptions = {
  locations: number;
  items: number;
  /** ISO date that the day offsets are counted from. */
  today: string;
};

export type BulkSeedSummary = { locations: number; items: number; manufacturers: number; externalIds: number };

/** Small deterministic generator, so two runs on the same database produce the same data. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cities = [
  'Plzeň', 'Liberec', 'Olomouc', 'Ústí nad Labem', 'Hradec Králové', 'České Budějovice', 'Pardubice', 'Zlín',
  'Havířov', 'Kladno', 'Most', 'Opava', 'Frýdek-Místek', 'Karlovy Vary', 'Jihlava', 'Teplice', 'Děčín',
  'Karviná', 'Chomutov', 'Přerov', 'Jablonec nad Nisou', 'Mladá Boleslav', 'Prostějov', 'Třebíč',
];
const topLevelKinds: Record<string, string[]> = {
  HQ: ['Centrála'],
  STORE: ['Prodejna'],
  SITE: ['Provozovna', 'Závod'],
  WAREHOUSE: ['Sklad', 'Logistické centrum'],
};
const rooms = [
  'Kancelář', 'Sklad', 'Dílna', 'Kuchyně', 'Chodba', 'Zasedací místnost', 'Serverovna', 'Šatna', 'Výdejna',
  'Regál', 'Zázemí', 'Recepce', 'Technická místnost', 'Archiv', 'Jídelna', 'Sociální zařízení',
];
const floors = ['Přízemí', '1. patro', '2. patro', 'Suterén', 'Půda'];
const streets = ['Nádražní', 'Masarykova', 'Průmyslová', 'Školní', 'Zahradní', 'Lipová', 'Mírové náměstí', 'Tovární'];

type Kind = { name: string; manufacturer?: string; models?: string[]; serviceable?: boolean };
const kinds: Kind[] = [
  { name: 'Konvektomat', manufacturer: 'Rational', models: ['iCombi Pro 6-1/1', 'iCombi Pro 10-1/1', 'iVario 2-S'], serviceable: true },
  { name: 'Průchozí myčka', manufacturer: 'Winterhalter', models: ['PT-M', 'UC-M', 'UF-L'], serviceable: true },
  { name: 'Chladicí skříň', manufacturer: 'Liebherr', models: ['GKPv 6590', 'FKv 4143', 'GGv 5060'], serviceable: true },
  { name: 'Klimatizace', manufacturer: 'Daikin', models: ['FTXM35R', 'FTXM50R', 'FCAG71B'], serviceable: true },
  { name: 'Vrtačka', manufacturer: 'Bosch', models: ['PBD 40', 'GSB 18V-55'] },
  { name: 'Úhlová bruska', manufacturer: 'Bosch', models: ['GWS 18V-10', 'GWS 22-230'] },
  { name: 'Vysokotlaký čistič', manufacturer: 'Kärcher', models: ['HD 6/13 C', 'K 5 Premium'], serviceable: true },
  { name: 'Průmyslový vysavač', manufacturer: 'Kärcher', models: ['NT 70/2', 'NT 30/1'] },
  { name: 'Pračka průmyslová', manufacturer: 'Electrolux Professional', models: ['WH6-11', 'WH6-7'], serviceable: true },
  { name: 'Indukční deska', manufacturer: 'Electrolux Professional', models: ['700XP', '900XP'] },
  { name: 'Univerzální robot', manufacturer: 'Hobart', models: ['HSM20', 'HSM30'] },
  { name: 'Hasicí přístroj práškový', models: ['6 kg', '2 kg', '12 kg'], serviceable: true },
  { name: 'Hasicí přístroj CO2', models: ['5 kg', '2 kg'], serviceable: true },
  { name: 'Notebook', manufacturer: 'Lenovo', models: ['ThinkPad E14', 'ThinkPad T14', 'IdeaPad 3'] },
  { name: 'Monitor', manufacturer: 'Dell', models: ['P2422H', 'U2723QE'] },
  { name: 'Tiskárna', manufacturer: 'HP', models: ['LaserJet Pro M404', 'OfficeJet 9010'] },
  { name: 'Projektor', manufacturer: 'Epson', models: ['EB-L200F', 'EB-W49'] },
  { name: 'Kompresor', manufacturer: 'Atlas Copco', models: ['GA 11', 'GX 3'], serviceable: true },
  { name: 'Vysokozdvižný vozík', manufacturer: 'Linde', models: ['E20', 'H30'], serviceable: true },
  { name: 'Paletový vozík', manufacturer: 'Jungheinrich', models: ['AM 22', 'EJE 116'] },
  { name: 'Svářečka', manufacturer: 'ESAB', models: ['Rebel EMP 215ic', 'Warrior 500i'] },
  { name: 'Pokladní systém', manufacturer: 'Dotykačka', models: ['Pro', 'Mini'] },
  { name: 'Stůl kancelářský' },
  { name: 'Regálový systém' },
  { name: 'Kávovar', manufacturer: 'Bosch', models: ['VeroCafe', 'TIS65'] },
  { name: 'UPS záložní zdroj', manufacturer: 'APC', models: ['Smart-UPS 1500', 'Smart-UPS 3000'], serviceable: true },
  { name: 'Router', manufacturer: 'MikroTik', models: ['RB4011', 'hAP ax3'] },
];
const sources = ['Elektrikář', 'Revize plynu', 'Vzduchotechnika', 'Hasiči', 'Vodoinstalatér', 'Revize VZV'];

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Adds many locations (a tree up to four levels deep) and items on top of what is in the database,
 * for trying out lists, paging and search with realistic volumes. Runs in one transaction.
 */
export async function seedBulk(db: Db, options: BulkSeedOptions): Promise<BulkSeedSummary> {
  const rand = random(20260929);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ n: count() }).from(items);
    if (existing!.n > 500) throw new BulkSeedRefusedError('The database already holds more than 500 items; not adding bulk data.');
    const [admin] = await tx.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1);
    if (!admin) throw new BulkSeedRefusedError('No admin user found; run `pnpm db:seed` first.');
    const by = admin.id;

    const typeIds = new Map((await createLocationTypeRepository(tx).list()).map((t) => [t.code, t.id]));
    const locationRepo = createLocationRepository(tx);

    // Existing locations are parents for the new ones too, at their real depth.
    const existingRows = await tx
      .select({ id: locations.id, parentId: locations.parentId })
      .from(locations)
      .orderBy(asc(locations.createdAt), asc(locations.id));
    const parentOf = new Map(existingRows.map((l) => [l.id, l.parentId]));
    const depthOf = (id: string): number => {
      const parentId = parentOf.get(id);
      return parentId ? depthOf(parentId) + 1 : 1;
    };
    const places = existingRows.map((l) => ({ id: l.id, depth: depthOf(l.id) }));

    let created = 0;
    const topLevelTarget = Math.max(1, Math.round(options.locations * 0.15));
    for (; created < options.locations; created++) {
      if (created < topLevelTarget) {
        const [typeCode, kindNames] = pick(Object.entries(topLevelKinds));
        const city = cities[created % cities.length]!;
        const row = await locationRepo.insert({
          name: `${pick(kindNames)} ${city}`,
          parentId: null,
          locationTypeId: typeIds.get(typeCode) ?? null,
          address: `${pick(streets)} ${between(1, 250)}, ${between(100, 799)} ${pad(between(0, 99), 2)} ${city}`,
          note: null,
          createdBy: by,
        });
        places.push({ id: row.id, depth: 1 });
        continue;
      }
      const parent = pick(places.filter((p) => p.depth < 4));
      const name = parent.depth === 1 && rand() < 0.5 ? pick(floors) : `${pick(rooms)} ${between(1, 30)}`;
      const row = await locationRepo.insert({
        name,
        parentId: parent.id,
        locationTypeId: null,
        address: null,
        note: rand() < 0.1 ? 'Klíč na recepci.' : null,
        createdBy: by,
      });
      places.push({ id: row.id, depth: parent.depth + 1 });
    }

    const manufacturerRepo = createManufacturerRepository(tx);
    const manufacturerIds = new Map((await tx.select({ id: manufacturers.id, name: manufacturers.name }).from(manufacturers)).map((m) => [m.name, m.id]));
    let newManufacturers = 0;
    for (const kind of kinds) {
      if (!kind.manufacturer || manufacturerIds.has(kind.manufacturer)) continue;
      manufacturerIds.set(kind.manufacturer, (await manufacturerRepo.insert({ name: kind.manufacturer, note: null, createdBy: by })).id);
      newManufacturers++;
    }

    const itemRepo = createItemRepository(tx);
    let externalIds = 0;
    for (let n = 0; n < options.items; n++) {
      const kind = pick(kinds);
      const model = kind.models ? pick(kind.models) : null;
      const year = between(2015, new Date(options.today).getUTCFullYear());
      const registered = -between(30, 3000);
      const row = await itemRepo.insert({
        name: `${kind.name} ${pad(n + 1, 4)}`,
        locationId: pick(places).id,
        manufacturerId: kind.manufacturer ? manufacturerIds.get(kind.manufacturer)! : null,
        model,
        serialNumber: rand() < 0.7 ? `SN-${pad(between(0, 99999999), 8)}` : null,
        manufactureYear: year,
        registeredOn: addDays(options.today, registered),
        warrantyUntil: rand() < 0.6 ? addDays(options.today, registered + between(365, 1095)) : null,
        lastServiceOn: kind.serviceable ? addDays(options.today, -between(10, 400)) : null,
        nextServiceOn: kind.serviceable ? addDays(options.today, between(-60, 300)) : null,
        documentsUrl: null,
        note: rand() < 0.05 ? 'Poznámka k položce.' : null,
        createdBy: by,
      });
      if (rand() < 0.25) {
        const ids = Array.from({ length: between(1, 2) }, (_, k) => ({ source: pick(sources), value: `${pad(n + 1, 5)}-${k}` }));
        externalIds += (await itemRepo.replaceExternalIds(row.id, ids, by)).length;
      }
    }

    return { locations: options.locations, items: options.items, manufacturers: newManufacturers, externalIds };
  });
}
