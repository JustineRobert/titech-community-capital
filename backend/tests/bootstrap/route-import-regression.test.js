describe('route registry bootstrap regression', () => {
  it('imports the canonical route registry without ESM/CommonJS startup errors', async () => {
    await expect(import('../../routes/index.js')).resolves.toBeTruthy();
  });

  it('registers the canonical platform dashboard reporting router', async () => {
    const { default: platformDashboard } = await import('../../routes/platformDashboard.js');
    const routePaths = platformDashboard.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => {
        const routePath = layer.route.path;
        return Array.isArray(routePath) ? routePath : [routePath];
      });

    expect(routePaths).toContain('/dashboard');
    expect(routePaths).toContain('/reports/dashboard');
  });
});
