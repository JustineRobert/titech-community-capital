/**
 * TITech Community Capital — Capital Connectivity Public Contract
 * Role: stable export surface for governed capital connectivity.
 */

export { default as capitalRoutes } from './capital.routes.js';
export { CAPITAL_SHARE_STATUS, default as CapitalShareRequest } from './models/CapitalShareRequest.js';
export * from './services/capitalConnectivityService.js';
