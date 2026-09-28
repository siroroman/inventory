// Dev sample data. Dates are day offsets from "today", so the service and warranty badges
// (overdue, due within 30 days, expired warranty) always show up when the seed is run.

import type { Role } from '../../auth/roles.ts';

export const seedUsers: { email: string; name: string; role: Role }[] = [
  { email: 'admin@example.test', name: 'Alena Správcová', role: 'admin' },
  { email: 'write@example.test', name: 'Petr Zapisovatel', role: 'write' },
  { email: 'read@example.test', name: 'Lucie Čtenářová', role: 'read' },
];

export type SeedLocation = {
  name: string;
  /** Location type code; top-level locations only. */
  type?: string;
  address?: string;
  note?: string;
  children?: SeedLocation[];
};

export const seedLocations: SeedLocation[] = [
  {
    name: 'Centrála Praha',
    type: 'HQ',
    address: 'Vinohradská 1511/230, 100 00 Praha 10',
    children: [
      { name: 'Přízemí výroba', children: [{ name: 'Kuchyně' }, { name: 'Mycí linka' }] },
      { name: '1. patro kanceláře', children: [{ name: 'Zasedací místnost' }] },
      { name: 'Serverovna', note: 'Klíč na recepci.' },
    ],
  },
  {
    name: 'Prodejna Brno',
    type: 'STORE',
    address: 'Masarykova 12, 602 00 Brno',
    children: [{ name: 'Prodejní plocha' }, { name: 'Sklad prodejny' }],
  },
  {
    name: 'Provozovna Ostrava',
    type: 'SITE',
    address: 'Nádražní 45, 702 00 Ostrava',
    children: [{ name: 'Dílna', children: [{ name: 'Kompresorovna' }] }, { name: 'Šatny' }],
  },
  {
    name: 'Sklad Kolín',
    type: 'WAREHOUSE',
    address: 'Průmyslová 1024, 280 02 Kolín',
    children: [{ name: 'Regál A' }, { name: 'Regál B' }],
  },
];

export const seedProviders = [
  { name: 'Gastro Servis Novák s.r.o.', contactPerson: 'Jan Novák', phone: '+420 601 111 222', email: 'servis@gastro-novak.example', web: 'https://gastro-novak.example' },
  { name: 'Chladservis Dvořák', contactPerson: 'Tomáš Dvořák', phone: '+420 602 333 444', email: 'dvorak@chladservis.example' },
  { name: 'Elektro Kučera', contactPerson: 'Pavel Kučera', phone: '+420 603 555 666' },
  { name: 'Klima Plus a.s.', contactPerson: 'Eva Svobodová', phone: '+420 604 777 888', email: 'objednavky@klimaplus.example', web: 'https://klimaplus.example' },
  { name: 'Technoservis Brno', contactPerson: 'Martin Říha', phone: '+420 605 999 000', note: 'Pouze Morava.' },
] as const;

type ProviderName = (typeof seedProviders)[number]['name'];

/** Manufacturers with their service providers in priority order. Kärcher has none on purpose. */
export const seedManufacturers: { name: string; note?: string; providers: ProviderName[] }[] = [
  { name: 'Rational', note: 'Konvektomaty, záruka 2 roky.', providers: ['Gastro Servis Novák s.r.o.', 'Technoservis Brno'] },
  { name: 'Electrolux Professional', providers: ['Gastro Servis Novák s.r.o.'] },
  { name: 'Winterhalter', providers: ['Gastro Servis Novák s.r.o.', 'Technoservis Brno'] },
  { name: 'Hobart', providers: ['Technoservis Brno', 'Gastro Servis Novák s.r.o.', 'Elektro Kučera'] },
  { name: 'Daikin', providers: ['Klima Plus a.s.', 'Chladservis Dvořák'] },
  { name: 'Liebherr', providers: ['Chladservis Dvořák', 'Klima Plus a.s.'] },
  { name: 'Bosch', providers: ['Elektro Kučera'] },
  { name: 'Kärcher', providers: [] },
];

export type SeedItem = {
  name: string;
  /** Name of the location; names are unique within this data set. */
  location: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  manufactureYear?: number;
  /** Day offsets from today. */
  registered?: number;
  warranty?: number;
  lastService?: number;
  nextService?: number;
  documentsUrl?: string;
  note?: string;
  externalIds?: [source: string, value: string][];
};

const DRIVE = 'https://drive.google.com/drive/folders/';

export const seedItems: SeedItem[] = [
  // Centrála Praha
  { name: 'Konvektomat 10 GN', location: 'Kuchyně', manufacturer: 'Rational', model: 'iCombi Pro 10-1/1', serialNumber: 'E11SI22031456', manufactureYear: 2022, registered: -900, warranty: -170, lastService: -200, nextService: -10, documentsUrl: `${DRIVE}1RatKonv10GN`, externalIds: [['Elektrikář', 'EL-4821'], ['Revize plynu', 'RP-2025-117']] },
  { name: 'Konvektomat 6 GN', location: 'Kuchyně', manufacturer: 'Rational', model: 'iCombi Pro 6-1/1', serialNumber: 'E61SI23040112', manufactureYear: 2023, registered: -500, warranty: 230, lastService: -150, nextService: 14, externalIds: [['Elektrikář', 'EL-4822']] },
  { name: 'Indukční varná deska', location: 'Kuchyně', manufacturer: 'Electrolux Professional', model: '700XP', serialNumber: '41200875', manufactureYear: 2021, registered: -1200, warranty: -470, lastService: -300, nextService: 65, externalIds: [['Elektrikář', 'EL-4823']] },
  { name: 'Chladicí skříň', location: 'Kuchyně', manufacturer: 'Liebherr', model: 'GKPv 6590', serialNumber: '88.431.912.4', manufactureYear: 2020, registered: -1500, warranty: -770, lastService: -340, nextService: 25 },
  { name: 'Mrazicí box', location: 'Kuchyně', manufacturer: 'Liebherr', model: 'GGv 5060', serialNumber: '88.512.004.1', manufactureYear: 2024, registered: -200, warranty: 530, nextService: 165 },
  { name: 'Univerzální robot', location: 'Kuchyně', manufacturer: 'Hobart', model: 'HSM20', manufactureYear: 2019, registered: -2000 },
  { name: 'Průchozí myčka nádobí', location: 'Mycí linka', manufacturer: 'Winterhalter', model: 'PT-M', serialNumber: 'WH-PTM-77120', manufactureYear: 2022, registered: -800, warranty: -70, lastService: -95, nextService: 5, externalIds: [['Elektrikář', 'EL-4830'], ['Vodoinstalatér', 'V-042']] },
  { name: 'Myčka skla', location: 'Mycí linka', manufacturer: 'Winterhalter', model: 'UC-S', serialNumber: 'WH-UCS-10451', manufactureYear: 2023, registered: -450, warranty: 280, lastService: -60, nextService: 120 },
  { name: 'Změkčovač vody', location: 'Mycí linka', manufacturer: 'Winterhalter', model: 'MonoMatik 3', manufactureYear: 2022, registered: -800, nextService: -40, note: 'Sůl doplňovat každý týden.' },
  { name: 'Klimatizace zasedačka', location: 'Zasedací místnost', manufacturer: 'Daikin', model: 'FTXM35R', serialNumber: 'D35R-2201887', manufactureYear: 2022, registered: -700, warranty: 30, lastService: -180, nextService: 28, externalIds: [['Vzduchotechnika', 'VZT-015']] },
  { name: 'Projektor', location: 'Zasedací místnost', model: 'Epson EB-L200F', serialNumber: 'X7JK1200345', manufactureYear: 2021, registered: -1100, warranty: -370 },
  { name: 'Kávovar', location: '1. patro kanceláře', manufacturer: 'Bosch', model: 'VeroCafe', manufactureYear: 2024, registered: -120, warranty: 610 },
  { name: 'Hasicí přístroj práškový 6 kg', location: '1. patro kanceláře', manufactureYear: 2020, registered: -1400, lastService: -380, nextService: -15, externalIds: [['Hasiči', 'HP-0101']] },
  { name: 'Klimatizace serverovna', location: 'Serverovna', manufacturer: 'Daikin', model: 'FTXM50R', serialNumber: 'D50R-2104410', manufactureYear: 2021, registered: -1000, warranty: -270, lastService: -170, nextService: 10, documentsUrl: `${DRIVE}1DaikinServer`, externalIds: [['Vzduchotechnika', 'VZT-016'], ['Elektrikář', 'EL-4840']] },
  { name: 'UPS záložní zdroj', location: 'Serverovna', model: 'APC Smart-UPS 3000', serialNumber: 'AS2104112233', manufactureYear: 2021, registered: -1000, warranty: -270, lastService: -330, nextService: 35, externalIds: [['Elektrikář', 'EL-4841']] },
  { name: 'Hasicí přístroj CO2 5 kg', location: 'Serverovna', manufactureYear: 2021, registered: -1000, lastService: -350, nextService: 15, externalIds: [['Hasiči', 'HP-0102']] },
  // Prodejna Brno
  { name: 'Chladicí vitrína', location: 'Prodejní plocha', manufacturer: 'Liebherr', model: 'FKv 4143', serialNumber: '88.230.118.2', manufactureYear: 2023, registered: -400, warranty: 330, lastService: -100, nextService: 80 },
  { name: 'Pokladní systém', location: 'Prodejní plocha', model: 'Dotykačka Pro', manufactureYear: 2024, registered: -250, warranty: 480 },
  { name: 'Klimatizace prodejna', location: 'Prodejní plocha', manufacturer: 'Daikin', model: 'FCAG71B', serialNumber: 'D71B-2303311', manufactureYear: 2023, registered: -380, warranty: 350, lastService: -175, nextService: 3, externalIds: [['Vzduchotechnika', 'VZT-101']] },
  { name: 'Regálový systém', location: 'Sklad prodejny', registered: -900 },
  { name: 'Vysavač', location: 'Sklad prodejny', manufacturer: 'Kärcher', model: 'T 12/1', manufactureYear: 2022, registered: -700, warranty: -3 },
  { name: 'Hasicí přístroj pěnový 9 l', location: 'Sklad prodejny', manufactureYear: 2022, registered: -700, lastService: -300, nextService: 65, externalIds: [['Hasiči', 'HP-0201']] },
  // Provozovna Ostrava
  { name: 'Kompresor šroubový', location: 'Kompresorovna', model: 'Atlas Copco GA 11', serialNumber: 'API123456', manufactureYear: 2019, registered: -2100, warranty: -1300, lastService: -190, nextService: -5, documentsUrl: `${DRIVE}1KompresorGA11`, externalIds: [['Elektrikář', 'EL-5001'], ['Revize tlakových nádob', 'TN-2024-08']] },
  { name: 'Sušička vzduchu', location: 'Kompresorovna', model: 'Atlas Copco FX 3', manufactureYear: 2019, registered: -2100, lastService: -190, nextService: 175 },
  { name: 'Vysokotlaký čistič', location: 'Dílna', manufacturer: 'Kärcher', model: 'HD 6/13 C', serialNumber: 'KA-0612-4471', manufactureYear: 2021, registered: -1050, warranty: -320, lastService: -365, nextService: 0 },
  { name: 'Stojanová vrtačka', location: 'Dílna', manufacturer: 'Bosch', model: 'PBD 40', serialNumber: 'BO-PBD-883120', manufactureYear: 2020, registered: -1600, warranty: -870 },
  { name: 'Úhlová bruska', location: 'Dílna', manufacturer: 'Bosch', model: 'GWS 18V-10', manufactureYear: 2023, registered: -300, warranty: 430 },
  { name: 'Svářečka', location: 'Dílna', model: 'ESAB Rebel EMP 215ic', serialNumber: 'ES-215-99812', manufactureYear: 2022, registered: -650, warranty: 80, lastService: -330, nextService: 35, externalIds: [['Elektrikář', 'EL-5002']] },
  { name: 'Pračka průmyslová', location: 'Šatny', manufacturer: 'Electrolux Professional', model: 'WH6-11', serialNumber: '91450032', manufactureYear: 2020, registered: -1450, warranty: -720, lastService: -160, nextService: 20 },
  { name: 'Šatní skříně (sada 12 ks)', location: 'Šatny', registered: -1450 },
  // Sklad Kolín
  { name: 'Vysokozdvižný vozík', location: 'Sklad Kolín', model: 'Linde E20', serialNumber: 'LI-E20-7731', manufactureYear: 2020, registered: -1500, warranty: -770, lastService: -170, nextService: 10, externalIds: [['Revize VZV', 'VZV-2025-3']] },
  { name: 'Paletový vozík', location: 'Regál A', model: 'Jungheinrich AM 22', manufactureYear: 2018, registered: -2500 },
  { name: 'Průmyslový vysavač', location: 'Regál A', manufacturer: 'Kärcher', model: 'NT 70/2', manufactureYear: 2021, registered: -1100, warranty: -400 },
  { name: 'Průmyslová myčka podlah', location: 'Regál B', manufacturer: 'Kärcher', model: 'B 50 W', serialNumber: 'KA-B50-10077', manufactureYear: 2023, registered: -420, warranty: 310, lastService: -120, nextService: 60 },
  { name: 'Hasicí přístroj práškový 6 kg', location: 'Regál B', manufactureYear: 2022, registered: -700, lastService: -300, nextService: 65, externalIds: [['Hasiči', 'HP-0301']] },
];
