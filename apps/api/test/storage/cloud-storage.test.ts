import { describe, expect, it } from 'vitest';
import { contentDisposition, createCloudStorage, type StorageFile } from '../../src/storage/cloud-storage.ts';

const NOW = Date.UTC(2026, 9, 2, 12);

function setup(file: Partial<StorageFile> = {}) {
  const signed: Parameters<StorageFile['getSignedUrl']>[0][] = [];
  const names: string[] = [];
  const deletes: { ignoreNotFound: boolean }[] = [];
  const storage = createCloudStorage(
    {
      file: (name) => {
        names.push(name);
        return {
          getSignedUrl: async (config) => {
            signed.push(config);
            return [`https://signed.test/${name}`];
          },
          getMetadata: async () => [{ size: '1234', contentType: 'application/pdf' }],
          delete: async (options) => void deletes.push(options),
          ...file,
        };
      },
    },
    () => NOW,
  );
  return { storage, signed, names, deletes };
}

describe('createCloudStorage', () => {
  it('signs a PUT for one type and a size range, valid for 15 minutes', async () => {
    const { storage, signed } = setup();
    const url = await storage.createUploadUrl('service-records/r/a.pdf', 'application/pdf', 20_000_000);
    expect(url).toBe('https://signed.test/service-records/r/a.pdf');
    expect(signed).toEqual([
      {
        version: 'v4',
        action: 'write',
        expires: NOW + 15 * 60 * 1000,
        contentType: 'application/pdf',
        extensionHeaders: { 'x-goog-content-length-range': '0,20000000' },
      },
    ]);
  });

  it('signs a GET for the requested time, with the download name when given', async () => {
    const { storage, signed } = setup();
    await storage.createReadUrl('k.jpg', 900);
    await storage.createReadUrl('k.pdf', 900, { fileName: 'Revizní zpráva.pdf' });
    expect(signed[0]).toMatchObject({ action: 'read', expires: NOW + 900_000, responseDisposition: undefined });
    expect(signed[1]?.responseDisposition).toBe("inline; filename*=UTF-8''Revizn%C3%AD%20zpr%C3%A1va.pdf");
  });

  it('signs a download link that saves the file instead of opening it', async () => {
    const { storage, signed } = setup();
    await storage.createReadUrl('k.pdf', 900, { fileName: 'Zpráva.pdf', download: true });
    await storage.createReadUrl('k.pdf', 900, { download: true });
    expect(signed[0]?.responseDisposition).toBe("attachment; filename*=UTF-8''Zpr%C3%A1va.pdf");
    expect(signed[1]?.responseDisposition).toBe('attachment');
  });

  it('reports size and type of a stored object, and null when it is missing', async () => {
    expect(await setup().storage.head('k')).toEqual({ size: 1234, contentType: 'application/pdf' });
    const missing = setup({ getMetadata: () => Promise.reject(Object.assign(new Error('No such object'), { code: 404 })) });
    expect(await missing.storage.head('k')).toBeNull();
  });

  it('does not hide other storage failures', async () => {
    const down = setup({ getMetadata: () => Promise.reject(Object.assign(new Error('unavailable'), { code: 503 })) });
    await expect(down.storage.head('k')).rejects.toThrow('unavailable');
  });

  it('deletes without failing on a file that is already gone', async () => {
    const { storage, names, deletes } = setup();
    await storage.delete('k');
    expect(names).toEqual(['k']);
    expect(deletes).toEqual([{ ignoreNotFound: true }]);
  });
});

describe('contentDisposition', () => {
  it('escapes quotes, parentheses and other characters a header could trip on', () => {
    expect(contentDisposition(`a"b (1)'*.pdf`)).toBe("inline; filename*=UTF-8''a%22b%20%281%29%27%2A.pdf");
    expect(contentDisposition('a.pdf', 'attachment')).toBe("attachment; filename*=UTF-8''a.pdf");
  });
});
