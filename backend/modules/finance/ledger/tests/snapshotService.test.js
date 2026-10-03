import SnapshotService from '../core/snapshotService.js';

describe('TITech snapshot service', () => {
  test('creates deterministic, hashed tenant snapshots', async () => {
    const service = new SnapshotService({ clock: () => new Date('2026-10-03T00:00:00.000Z') });
    const snapshot = await service.create({
      type: 'PERIOD_CLOSE',
      context: { tenant: { tenantId: 'tenant-001' } },
      balances: { cash: '1000.00' },
      history: [{ id: 'entry-1' }],
    });
    expect(snapshot.id).toMatch(/^SNP-/);
    expect(snapshot.hash).toHaveLength(64);
  });
});
