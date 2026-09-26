#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BACKEND=path.join(ROOT,'backend');
const EXCLUDE=new Set(['node_modules','.git','dist','coverage','build']);
const EXTS=new Set(['.js','.mjs','.cjs']);
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(EXCLUDE.has(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else if(EXTS.has(path.extname(e.name)))out.push(p);}return out;}
const files=walk(BACKEND);const rel=p=>path.relative(ROOT,p).replaceAll('\\','/');
function stripComments(text){return text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'$1');}
function classify(text){const scan=stripComments(text);const c={import:/\bimport\s/.test(scan),export:/\bexport\s/.test(scan),require:/\brequire\s*\(/.test(scan),moduleExports:/\bmodule\.exports\b/.test(scan),exportsProperty:/\bexports\.[A-Za-z_$][\w$]*/.test(scan)};const esm=c.import||c.export;const cjs=c.require||c.moduleExports||c.exportsProperty;return {kind:esm?(cjs?'hybrid':'esm'):(cjs?'commonjs':'unknown'),markers:c};}
const records=files.map(p=>({path:rel(p),...classify(fs.readFileSync(p,'utf8'))}));
const summary=records.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{});
const bootstrap=records.filter(r=>r.path.startsWith('backend/bootstrap/'));
const result={generatedAt:new Date().toISOString(),packageType:JSON.parse(fs.readFileSync(path.join(BACKEND,'package.json'),'utf8')).type,summary,bootstrapLegacySurface:bootstrap.filter(r=>['commonjs','hybrid'].includes(r.kind)),policy:'Mixed CJS/ESM is preserved; changes must create explicit compatibility boundaries rather than a repository-wide conversion.'};
fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true});fs.writeFileSync(path.join(ROOT,'reports/module-forensics.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({summary,bootstrapLegacySurfaceCount:result.bootstrapLegacySurface.length},null,2));
