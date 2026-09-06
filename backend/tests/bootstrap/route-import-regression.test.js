describe('route registry bootstrap regression', () => {
  it('imports the canonical route registry without ESM/CommonJS startup errors', async () => {
    await expect(import('../../routes/index.js')).resolves.toBeTruthy();
  });
});
