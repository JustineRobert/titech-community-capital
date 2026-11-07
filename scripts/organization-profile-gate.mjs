import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const profile = JSON.parse(read('branding/TITECH_ORGANIZATION_PROFILE.json'));
const theme = JSON.parse(read('branding/TITECH_OFFICIAL_THEME.json'));
const manifest = JSON.parse(read('branding/BRAND_MANIFEST.json'));
const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
}
check('product identity', profile.productName === 'TITech Community Capital' && theme.product === 'TITech Community Capital');
check('configured organization identity', profile.organizationDisplayName === 'TITech Capital SMC LTD' && profile.configuredLegalName === 'TITech Capital SMC LTD' && theme.organizationLegalName === 'TITech Capital SMC LTD');
check('postal address', profile.postalAddress === 'P.O. BOX 601200');
check('postal location', profile.postalLocation === 'Clock Tower');
check('portal association preserved separately', profile.administrativeAssociationName === 'TITECH CAPITAL SMC LTD');
check('identity remains externally unverified', profile.identityStatus === 'PENDING_EXTERNAL_DOCUMENTARY_VERIFICATION');
check('production approval remains disabled', profile.productionApproved === false);
const brand = read('frontend/src/branding/brand.js');
const backendBrand = read('backend/shared/branding/brandConfig.cjs');
const legalConfig = read('frontend/src/legal/legalConfig.js');
const footer = read('frontend/src/components/Footer.jsx');
check('frontend brand profile wired', brand.includes('TITECH_ORGANIZATION') && brand.includes('TITech Capital SMC LTD'));
check('backend brand profile wired', backendBrand.includes("postalAddress: 'P.O. BOX 601200'") && backendBrand.includes("administrativeAssociationName: 'TITECH CAPITAL SMC LTD'"));
check('legal address wired', legalConfig.includes("postalAddress: 'P.O. BOX 601200'") && legalConfig.includes("postalLocation: 'Clock Tower'"));
check('footer displays postal metadata', footer.includes('COMPANY_POSTAL_ADDRESS') && footer.includes('titech-footer-postal-address'));
const expected = theme.palette;
const manifestPalette = manifest.platform_theme?.palette;
const paletteMatches = Object.entries(expected).every(([key, value]) => manifestPalette?.[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] === value);
const paletteMatchesFrontend = Object.entries(expected).every(([key, value]) => brand.includes(`${key}: '${value}'`));
check('nine-color official theme remains consistent', Object.keys(expected).length === 9 && paletteMatches && paletteMatchesFrontend);
const failures = checks.filter((item) => item.status === 'FAIL');
console.log(JSON.stringify({ gate: 'organization-profile', status: failures.length ? 'FAIL' : 'PASS', checks }, null, 2));
if (failures.length) process.exitCode = 1;
