import path from 'node:path';

const BACKEND_INSTALL_COMMAND = 'npm --prefix backend ci';

/**
 * Import a backend dependency with an actionable diagnostic. Keeping this
 * loader dependency-free lets migration/index CLIs explain missing packages
 * before their runtime dependency graph is available.
 */
export async function importBackendDependency(specifier, importer = () => import(specifier)) {
  try {
    return await importer();
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;

    const missingName = error.message.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/i)?.[1] || specifier;
    const isPackageSpecifier = !specifier.startsWith('.') && !path.isAbsolute(specifier) && !specifier.startsWith('node:');
    const guidance = isPackageSpecifier
      ? `From the repository root run "${BACKEND_INSTALL_COMMAND}" and retry.`
      : `Verify that the source module exists at the referenced path; dependency installation cannot restore missing application source.`;
    throw new Error(
      `Required backend module "${missingName}" is unavailable. ${guidance}`,
      { cause: error },
    );
  }
}

export async function loadBackendEnvironment({ backendDirectory } = {}) {
  const { default: dotenv } = await importBackendDependency('dotenv');
  const directory = path.resolve(backendDirectory || path.resolve(process.cwd(), 'backend'));
  const envPath = path.join(directory, '.env');
  const result = dotenv.config({ path: envPath });

  if (result?.error && result.error.code !== 'ENOENT') {
    throw new Error(`Unable to load backend environment configuration from ${path.basename(envPath)}.`, {
      cause: result.error,
    });
  }

  return { envPath, loaded: Boolean(result?.parsed) };
}
