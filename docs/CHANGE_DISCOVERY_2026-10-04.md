# TITech Community Capital — Change Discovery 2026-10-04

Compared the uploaded baseline `titech-community-capital-main(1).zip` against the final working tree packaged on 2026-10-04.

**Counts:** 2991 baseline files → 3024 current files; **33 added**, **12 modified**, **0 removed**; **45 total changed/added/removed paths**.

## Step-by-step discovery

1. Inventory package/toolchain, backend/frontend structure, bootstrap, middleware, models, routes, financial services, authentication/tenant boundaries, offline surfaces, branding, tests, migrations, CI/CD and evidence scripts.
2. Trace the canonical `ApplicationBootstrap → BootstrapContext → context/index` import/lifecycle/result path and verify the actual ESM contracts.
3. Map existing Group/Member/RBAC/audit/FinancialTransaction/outbox authorities before adding agriculture, keeping money and financial effects inside the existing financial boundary.
4. Inspect the official branding contracts and supplied reference asset; preserve the nine official palette values and wire new agriculture UI to the same semantic token layer.
5. Apply the smallest canonical fixes: protected lifecycle result handling, restart-safe bootstrap ownership, logger/resilience ESM repairs, agriculture vertical slice, tenant/RBAC protection, exact quantity arithmetic and settlement bridging.
6. Run narrow contract/domain tests, then static/theme/financial/security/implementation/release gates and the runtime-import audit.
7. Compare every current file against the uploaded baseline and persist exact path/bytes/lines/SHA-256 evidence.

## Changed folders

- `.`
- `backend/bootstrap`
- `backend/bootstrap/context`
- `backend/middleware`
- `backend/middleware/resilience`
- `backend/models`
- `backend/modules/agriculture`
- `backend/modules/agriculture/controllers`
- `backend/modules/agriculture/domain`
- `backend/modules/agriculture/models`
- `backend/modules/agriculture/routes`
- `backend/modules/agriculture/services`
- `backend/routes`
- `backend/scripts`
- `backend/tests/bootstrap`
- `backend/tests/unit/agriculture`
- `docs`
- `docs/agriculture`
- `frontend/src`
- `frontend/src/branding`
- `frontend/src/pages/agriculture`
- `reports`
- `scripts`

## Added files

| Path | Bytes | Lines | SHA-256 |
|---|---:|---:|---|
| `TITECH_CHANGE_MANIFEST_2026-10-04.md` | 9770 | 101 | `1682a744f3906fd89648aafbde9b44f9b43496d293339d3f6bd42217f003a09f` |
| `backend/modules/agriculture/constants.js` | 2879 | 81 | `b189333ca922ebe791ffaab069e002a5e27dc6dfbcd224ddcbbcf4de744232c1` |
| `backend/modules/agriculture/controllers/agriculture.controller.js` | 4436 | 26 | `5ebec6859e2b1bf5caac7cce358551d9824b6063e8e0c3f55abd503f2f0f5366` |
| `backend/modules/agriculture/domain/agriculture.domain.js` | 8339 | 193 | `425b720065db85f6edce63b4e93de23113c11abaf6d791c0c97cb9fc88f3be42` |
| `backend/modules/agriculture/index.js` | 653 | 11 | `419dcb2278fbfe40c1f65f1e0f85052791e7f379b146f8f059a257d3e3a8cb5f` |
| `backend/modules/agriculture/models/AgricultureSettlement.js` | 3168 | 39 | `04596b968c71364a4d807eff792e3edbefa3beab8fa1db7ced80a60a170bad40` |
| `backend/modules/agriculture/models/Buyer.js` | 1717 | 23 | `5c521d2633ea5507f988d81e67a6986439d9dee72e587147d38fa1916b31af06` |
| `backend/modules/agriculture/models/Commodity.js` | 1206 | 18 | `d547d3f6f61684b5844f1599ea7ecd84d97521ab3c79ce0195641bd5e951b957` |
| `backend/modules/agriculture/models/Delivery.js` | 2316 | 29 | `f931948cce49ce49b93aa42335242f2a1cb9eff3b9e51f40cd0b0371e1ca7eab` |
| `backend/modules/agriculture/models/Farm.js` | 2123 | 27 | `d6a57c30cb79b2dacb23ecf6e754afce4eb47c5786b64cdd94adc29840c99c23` |
| `backend/modules/agriculture/models/OfftakeContract.js` | 2295 | 30 | `02ccf4b85a211dee57c0d6be5ecfeb994888692da3a80ac553db3050c273f48e` |
| `backend/modules/agriculture/models/Producer.js` | 2575 | 31 | `fdcb49205d243434c0f42fbeedc8ac55eb6f3278e9e54dc66bdfdc6688ee4860` |
| `backend/modules/agriculture/models/ProductionCycle.js` | 3118 | 43 | `71cc447d9a8b6817ab0d1336855e9d73af0a64da9ab4335e0300016f3056d1d6` |
| `backend/modules/agriculture/routes/agriculture.routes.js` | 2863 | 40 | `6fa0a5297fbb05b49680e42ce87b7d141f6626803b37e960512e1deb9ae4556c` |
| `backend/modules/agriculture/services/agriculture.service.js` | 30946 | 281 | `581bae531f27f78215315e5ca20cfc6df1255a39cd909a940093e18d62283420` |
| `backend/scripts/migrate-agriculture-foundation.mjs` | 980 | 29 | `23eaf572d0e77d5cf8c33ae6d009331cb34df226f697cff93e2162bb036491b7` |
| `backend/tests/bootstrap/context-contract.test.js` | 5410 | 115 | `d5c63ae42feaa103ae33e4c8ba2edc0077eb9d3c7c005e1d991f87b069adfd9b` |
| `backend/tests/unit/agriculture/agriculture.domain.test.js` | 2420 | 61 | `9952209a3ebfeb17b49231bb9a8ef20846b3822777f287f3d974a967f5baad37` |
| `docs/BOOTSTRAP_REMEDIATION_2026-10-04.md` | 4313 | 56 | `c32b49de1197a56da22d022acaefce47e4a6f308cf2f9226cd5ab3b24afc0dd0` |
| `docs/CHANGE_DISCOVERY_2026-10-04.md` | 9013 | 108 | `490495566744c77cc16303e53906555659665cd81c22b13d55bbb35aeff1af0c` |
| `docs/FINAL_IMPLEMENTATION_REPORT_2026-10-04.md` | 14545 | 197 | `ebe3ce20b3fc3acf3af8bb9e48839fc3882715fc80667161079fb90c504f67b8` |
| `docs/agriculture/AGRICULTURE_ARCHITECTURE.md` | 2744 | 42 | `5538acaa5d00b11cc761fdb34047f8b920c52d3a540ce330b8e6e1c29e578655` |
| `docs/agriculture/IMPLEMENTATION_STATUS.md` | 2463 | 23 | `0b7585e9f1917752b28ec46fc568fea839f22259beeafb1568c58569e0986835` |
| `docs/agriculture/OFFLINE_SYNC.md` | 1154 | 29 | `f8e3069c561f97da50f98c60aa4adc961941b2b9e0aa4e046c732b1f9948f13f` |
| `frontend/src/pages/agriculture/AgricultureDashboard.css` | 4995 | 41 | `c53c9947743bb0200945cb6fa77ef9a2d7017d09d36b5948dd85814f7d42c7f7` |
| `frontend/src/pages/agriculture/AgricultureDashboard.jsx` | 5370 | 111 | `480bb68d67fced0e9307709ee03f2d2a66eda21c0b5e3e81b3bb579316b0fc7a` |
| `reports/change-discovery-2026-10-04.csv` | 5643 | 46 | `6eeb2dd555ae2ba0d79de28fd4b85499ffb046070a33a35075b1789c16d5f6f9` |
| `reports/change-discovery-2026-10-04.json` | 10984 | 354 | `b33673fc4122dca06441baa0c7b1af3ff8b57b0874ecc907e6884d37f0bc2428` |
| `reports/official-theme-audit-2026-10-04.json` | 2655 | 87 | `b68569b212694cbc252bbf9c9b4d3ae08f4a0989525108e54030954a2504b706` |
| `reports/release-readiness.json` | 2065 | 75 | `fb2d036b2a0ca692083b75872def0867f3c6652f232346329a356e55669f6925` |
| `reports/runtime-import-audit.json` | 38238 | 1259 | `6e892c05bb052fb9f90600e2a4794526917c986e1823e6eed1b9c2efddb501fe` |
| `reports/security-static-gate.json` | 367 | 15 | `25b40da8ce93a6bbdbf9f9dfcc2ca2975dbde6d55e2cf2f079ee75c86101b17d` |
| `reports/titech-implementation-gate-2026-10-02.json` | 387 | 10 | `4132ca28fa8daf781c1e7b6a37926febc715c071dd57d45343a198764b30ec42` |

## Modified files

| Path | Bytes | Lines | SHA-256 |
|---|---:|---:|---|
| `TITECH_IMPLEMENTATION_INVENTORY.md` | 4988 | 125 | `9ceac010282d954e3fa81dbb45a5fe9fb918f1e406391eead81e44637763e6ef` |
| `TITECH_PLATFORM_TRUTH.md` | 4350 | 55 | `1d84f91b284b3645f9a2c8da62b0a5f2a395863e11eb17b34896660ec1f18091` |
| `backend/bootstrap/ApplicationBootstrap.js` | 93866 | 5341 | `a500140c299f5e9ee4c5b18d6c2dc47abf68ac1b1816dc3ff8c61a73b622bd1a` |
| `backend/bootstrap/context/BootstrapContext.js` | 54841 | 2870 | `39064e01625af600963c647bf3e78c936872083edcaf00aba149ee47b9edf4a5` |
| `backend/bootstrap/logger.js` | 34934 | 2072 | `fd9cb092351b8f5d229db0e39c7bca49962dfd3fb26139316f9ef824b1f47a26` |
| `backend/middleware/platformPermissions.js` | 4196 | 92 | `b493824477b48144ab0d37467cc1383d73877e9b652e52035225291b2055622d` |
| `backend/middleware/resilience/index.js` | 63881 | 3665 | `70e12c5670a6b97f3653ee1747e3d199c1aee53a82e2f6d006ff080c5d1e5ce0` |
| `backend/models/Group.js` | 37806 | 1931 | `71316454604ec4d3a99902662223c83880b2e0fe35b5ce1a05776d5ed9d4838f` |
| `backend/routes/index.js` | 41805 | 1869 | `5563bd3e0891690b95ec6166c0cb25078093d42875d30a9b4d5ed162c3d743b8` |
| `frontend/src/App.jsx` | 19051 | 818 | `270b3ac22531be97436fb404fca1e8310023d7bacfa59d986ef2e63ed0855b42` |
| `frontend/src/branding/official-theme.css` | 16061 | 422 | `1f99fb583ecb0a89b65c2df1a623ad70c4ddd1dc419c956d3af5cf3b948529f3` |
| `scripts/official-theme-audit.mjs` | 7260 | 139 | `f4238249b1014d2e95db0024f4f186526e59039d48b5fddde9bf9d8fe7b2c156` |

## Removed files

**None.**

## Change interpretation

- No baseline files were deleted.
- No parallel agriculture ledger/wallet/identity/bootstrap was retained.
- One transient unused agriculture repository was created and removed during implementation; it is not part of the final tree and is not counted as a baseline deletion.
- The 249 repository-wide missing local imports remain legacy/non-critical debt outside the canonical financial surface; the final runtime-import audit remains PASS on that critical surface.
- Full dependency-backed runtime/provider/HTTP readiness remains environment-gated because the available runtime is Node 22.16.0 while the repository target is Node >=24.15.0/npm >=11.0.0 and project dependencies are not fully installed here.
