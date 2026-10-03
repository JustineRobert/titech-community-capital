import PeriodCloseService from '../../period/periodCloseService.js';

describe('TITech period close service', () => {
  test('requires repository persistence capabilities', () => {
    expect(() => new PeriodCloseService()).toThrow(TypeError);
  });

  test('reports repository capabilities deterministically', () => {
    const service = new PeriodCloseService({
      repository: { findById: jest.fn(), update: jest.fn() },
    });
    expect(service.diagnostics().repositoryConfigured).toBe(true);
    expect(service.diagnostics().repositoryCapabilities.findById).toBe(true);
  });
});
