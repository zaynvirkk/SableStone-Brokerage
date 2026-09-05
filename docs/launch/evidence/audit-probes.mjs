// Read-only production-source probes against a disposable, fully migrated database.
// Run from the SableStone repository with AUDIT_DATABASE_URL pointing ONLY at a test database.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
const local=async p=>import(pathToFileURL(path.join(root,p)).href);
const {default:ts}=await local('apps/web/node_modules/typescript/lib/typescript.js');
const {default:pg}=await local('node_modules/pg/lib/index.js');
const {SupplierPayoutReleaseDispatcher}=await local('dist/runtime/supplier_payouts.js');
const {buildProductionInboxHandlers}=await local('dist/runtime/inbox_processors.js');
if(!process.env.AUDIT_DATABASE_URL)throw new Error('Disposable AUDIT_DATABASE_URL required');
const pool=new pg.Pool({connectionString:process.env.AUDIT_DATABASE_URL});
const report={sqlAnalyzed:0,sqlErrors:[],parameterArraysChecked:0,parameterErrors:[],runtime:[]};
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.ts')?[path.join(dir,e.name)]:[])}
const queries=[];
for(const filename of files(path.join(root,'src'))){
 const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);
 function walk(n){
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query'&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])){
   const sql=n.arguments[0].text;
   if(/^\s*(select|with|insert|update|delete)\b/i.test(sql)){
    const location={file:path.relative(root,filename),line:source.getLineAndCharacterOfPosition(n.getStart(source)).line+1};
    queries.push({sql,...location});
    const args=n.arguments[1];
    if(args&&ts.isArrayLiteralExpression(args)&&!args.elements.some(e=>ts.isSpreadElement(e))){
     report.parameterArraysChecked++;
     const required=Math.max(0,...[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])));
     if(required!==args.elements.length)report.parameterErrors.push({...location,required,supplied:args.elements.length});
    }
   }
  }ts.forEachChild(n,walk);
 }walk(source);
}
try{
 const client=await pool.connect();
 try{for(const q of queries){const name=`audit_probe_${report.sqlAnalyzed++}`;try{await client.query(`PREPARE ${name} AS ${q.sql}`);await client.query(`DEALLOCATE ${name}`)}catch(e){report.sqlErrors.push({file:q.file,line:q.line,code:e.code,error:e.message})}}}finally{client.release()}
 for(const q of queries.filter(q=>q.sql.startsWith('insert into settlement_instructions'))){try{await pool.query(q.sql,Array(13).fill(null));report.runtime.push({probe:'settlement bind',unexpectedSuccess:true})}catch(e){report.runtime.push({probe:'settlement bind',code:e.code,error:e.message})}}
 try{await new SupplierPayoutReleaseDispatcher(pool,[]).dispatchBatch();report.runtime.push({probe:'supplier payout dispatch',unexpectedSuccess:true})}catch(e){report.runtime.push({probe:'supplier payout dispatch',code:e.code,error:e.message})}
 const adapter={provider:'RAZORPAY_ROUTE',config:{webhookEventTypePath:'event',webhookProviderReferencePath:'payload.payment.entity.order_id',webhookOccurredAtPath:'created_at',webhookEventTypeMap:{'payment.captured':'FUNDED'},webhookAmountPath:'payload.payment.entity.amount',webhookCurrencyPath:'payload.payment.entity.currency'}};
 for(const created_at of [1788600000,'2026-09-05T09:20:00Z']){
  const body={event:'payment.captured',created_at,payload:{payment:{entity:{order_id:'order_audit',amount:10000000,currency:'INR'}}}};
  const handlers=buildProductionInboxHandlers({pool:{query:async()=>({rows:[{gross_amount:'100000',currency:'INR'}]})},store:{readVerified:async()=>Buffer.from(JSON.stringify(body))},cipher:null,gmail:null,settlementAdapters:[adapter]});
  try{await handlers.RAZORPAY_ROUTE({payload_object_key:'audit',payload_digest:'fixture'});report.runtime.push({probe:'native payment payload',unexpectedSuccess:true})}catch(e){report.runtime.push({probe:'native payment payload',created_at,error:e.message})}
 }
 const npmCli=path.join(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
 const r=spawnSync(process.execPath,[npmCli,'run','build'],{encoding:'utf8',env:{...process.env,PATH:'/usr/bin:/bin'}});
 report.runtime.push({probe:'root build without undeclared global tsc',exitCode:r.status,stderr:r.stderr});
 console.log(JSON.stringify(report,null,2));
}finally{await pool.end()}
