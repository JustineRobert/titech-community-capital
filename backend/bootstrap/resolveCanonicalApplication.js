/**
 * Resolve the one Express application owned by the canonical bootstrap.
 *
 * Legacy callers may still expose the same app through `context.app`, while
 * the canonical lifecycle owns it through `bootstrap.getApplication()`. The
 * bootstrap owner takes precedence so a stale alias can never cause middleware
 * to create or bind a second Express instance after startup has begun.
 */
export function resolveCanonicalApplication(context = {}, createApplication, bootstrapOwner = null) {
  // ApplicationBootstrap passes itself as the second argument to a phase
  // initializer. Prefer that live owner over any legacy context alias.
  const bootstrap = bootstrapOwner || context?.bootstrap;
  const bootstrapApplication = (
    (typeof bootstrap?.getApplication === 'function' ? bootstrap.getApplication() : null) ||
    bootstrap?.application ||
    null
  );

  const application =
    bootstrapApplication ||
    context?.application ||
    context?.app ||
    (typeof createApplication === 'function' ? createApplication() : null);

  if (typeof application !== 'function') {
    const error = new TypeError('A canonical Express application is required for middleware initialization.');
    error.code = 'BOOTSTRAP_APPLICATION_UNAVAILABLE';
    throw error;
  }

  // Normalize legacy aliases to the identity owned by the bootstrap. Do not
  // call setApplication here: the lifecycle phase result performs the single
  // initial bind and remains responsible for enforcing the lifecycle lock.
  context.application = application;
  context.app = application;
  return application;
}
