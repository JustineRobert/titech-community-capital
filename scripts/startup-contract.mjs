#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BACKEND=path.join(ROOT,'backend');
const pkg=JSON.parse(fs.readFileSync(path.join(BACKEND,'package.json'),'utf8'));
const boot=fs.readFileSync(path.join(BACKEND,'bootstrap','ApplicationBootstrap.js'),'utf8');
const server=fs.readFileSync(path.join(BACKEND,'server.js'),'utf8');
const phases=['environment','configuration','logger','observability','readiness','resilience','infrastructure','services','middleware','routes','server'];
const errors=[];
for(const phase of phases){if(!new RegExp('name:\\s*[\\"\\\']'+phase+'[\\"\\\']').test(boot))errors.push('missing bootstrap phase: '+phase);}
if(pkg.type!=='module')errors.push('backend package must remain ESM');
if(!server.includes('./bootstrap/ApplicationBootstrap.js'))errors.push('server.js canonical bootstrap reference changed');
const result={generatedAt:new Date().toISOString(),runtimeTarget:pkg.engines,moduleContract:pkg.type,phaseOrder:phases,status:errors.length?'FAIL':'PASS',errors};
fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true});fs.writeFileSync(path.join(ROOT,'reports/startup-contract.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
