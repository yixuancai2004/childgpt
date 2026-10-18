import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {Provider} from '../src/llm.mjs';
const DUMMY_APP_TOKEN='DUMMY_APPLICATION_ACCESS_TOKEN_32CHARS';
async function setup(t,options={}){const dataDir=await mkdtemp(path.join(os.tmpdir(),'childgpt-test-'));const app=createApp({dataDir,provider:{enabled:false},...options});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;t.after(async()=>{app.closeAllConnections();await new Promise(r=>app.close(r));await rm(dataDir,{recursive:true,force:true});});const call=async(route,body,token,extra={})=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),...extra});return {status:r.status,data:await r.json()};};const session=async()=>{const r=await call('/api/session',{accessToken:DUMMY_APP_TOKEN});assert.equal(r.status,201);return r.data.sessionToken;};return {call,session,base,dataDir};}
test('HTTP sessions isolate different visitors, not just profile labels',async t=>{const {call,session}=await setup(t);const a=await session(),b=await session();await call('/api/turn',{input:{mode:'teach',concept:'tavi',content:'synthetic A fact'}},a);const readB=await call('/api/turn',{input:{mode:'ask',concept:'tavi'}},b);assert.equal(readB.status,200);assert.equal(readB.data.trace.allowedKnowledge.length,0);const readA=await call('/api/state',undefined,a);assert.equal(readA.data.state.profiles['learner-a'].memories.length,1);});
test('HTTP unauthorized access is rejected',async t=>{const {call}=await setup(t);assert.equal((await call('/api/state')).status,401);assert.equal((await call('/api/state',undefined,'a'.repeat(64))).status,401);});
test('HTTP applies elapsed-time forgetting and persists reinforcement without trusting client clocks', async t => {
 let now=Date.parse('2026-10-01T00:00:00Z'); const plans=[];
 const provider={enabled:true,async realize(plan){plans.push(plan);return {action:plan.action,text:'你能再教我一下吗？'};}};
 const {call,session,dataDir}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN,clock:()=>now}); const token=await session();
 await call('/api/turn',{input:{mode:'teach',concept:'月铃礼',content:'先系蓝绳；再敲三下铜铃'}},token);
 now+=3*86400000;
 const recall=await call('/api/turn',{input:{mode:'ask',concept:'月铃礼',clock:0},clock:0},token);
 assert.equal(recall.data.trace.action,'ask_to_learn');
 assert.equal(recall.data.trace.masteryAfter,.175);
 assert.deepEqual(plans.at(-1).permittedFacts,[]);
 assert.equal(plans.at(-1).latestMessage,null);
 assert.equal(plans.at(-1).learningStage.id,'discovering');
 await call('/api/turn',{input:{mode:'teach',concept:'月铃礼',content:'先系蓝绳；再敲三下铜铃'}},token);
 const saved=JSON.parse(await readFile(path.join(dataDir,(await readdir(dataDir))[0]),'utf8'));
 const memory=saved.state.profiles['learner-a'].memories[0];
 assert.equal(memory.stabilityDays,4.5);
 assert.equal(memory.learningCount,2);
 assert.equal(memory.lastReinforcedAt,new Date(now).toISOString());
 assert.equal(memory.content,'先系蓝绳；再敲三下铜铃');
});
test('public config omits secrets and unsafe origins cannot call API',async t=>{const {call,base}=await setup(t,{accessToken:DUMMY_APP_TOKEN});const c=await call('/api/config');assert.equal(c.data.requiresAccessToken,true);assert.equal(JSON.stringify(c.data).includes(DUMMY_APP_TOKEN),false);const rejected=await call('/api/session',{accessToken:DUMMY_APP_TOKEN},undefined,{headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'}});assert.equal(rejected.status,403);const okay=await call('/api/session',{accessToken:DUMMY_APP_TOKEN},undefined,{headers:{'Content-Type':'application/json',Origin:base}});assert.equal(okay.status,201);});
test('keyed backend cannot start without a strong separate app token',()=>assert.throws(()=>createApp({provider:{enabled:true},accessToken:''}),/APP_ACCESS_TOKEN/u));
test('wrong application access token rejected',async t=>{const {call}=await setup(t,{accessToken:DUMMY_APP_TOKEN});assert.equal((await call('/api/session',{accessToken:'wrong'})).status,401);});
test('API ignores user-supplied provider credentials and validates input',async t=>{const {call,session}=await setup(t);const token=await session();const r=await call('/api/turn',{input:{mode:'ask',concept:'tavi'},apiKey:'ATTACKER_TEXT',baseURL:'http://internal.invalid'},token);assert.equal(r.status,200);assert.equal(r.data.provider.enabled,false);assert.equal((await call('/api/turn',{input:{mode:'unsupported'}},token)).status,400);});
test('keyed end-to-end path uses grounded extraction and generated speech',async t=>{let extractionCalls=0,wordingCalls=0;const provider={enabled:true,async extract(){extractionCalls++;return {mode:'teach',concept:'tavi',content:'a sunny moment',text:'tavi means a sunny moment'};},async realize(plan){wordingCalls++;return {action:plan.action,text:'So tavi is a sunny moment — have I got that right?'};}};const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();const r=await call('/api/turn',{input:{mode:'chat',text:'tavi means a sunny moment'}},token);assert.equal(r.status,200);assert.equal(extractionCalls,1);assert.equal(wordingCalls,1);assert.equal(r.data.provider.extraction,'api-grounded-spans');assert.equal(r.data.trace.realization,'api-generated-response');assert.ok(r.data.message.includes('a sunny moment'));});
test('provider failure visibly falls back without losing memory',async t=>{const provider={enabled:true,async extract(){throw new Error('no network');},async realize(){throw new Error('no network');}};const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();const r=await call('/api/turn',{input:{mode:'teach',concept:'tavi',content:'remember me'}},token);assert.equal(r.status,200);assert.ok(r.data.provider.wording.includes('fallback'));assert.equal(r.data.trace.allowedKnowledge[0],'remember me');});
test('HTTP speech fallback greets in Chinese without the old teaching instructions', async t => {
 const provider={enabled:true,async extract(){throw new Error('offline');},async realize(){throw new Error('offline');}};
 const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 const r=await call('/api/turn',{input:{mode:'chat',text:'嗨，Milo。'}},token);
 assert.equal(r.status,200);
 assert.equal(r.data.trace.conversation.language,'Chinese');
 assert.match(r.data.message,/[嗨在来]/u);
 assert.doesNotMatch(r.data.message,/tavi|what you would like|教学|概念/u);
 assert.ok(r.data.provider.wording.includes('fallback'));
 assert.equal(r.data.state.profiles['learner-a'].memories.length,0);
});
test('HTTP accepts natural teaching acknowledgments with no confirmation question', async t => {
 const provider={enabled:true,async realize(plan){assert.equal(plan.requiresQuestion,false);return {action:plan.action,text:'哦，你们把一起喝茶的时光叫澄芽呀。'};}};
 const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 const r=await call('/api/turn',{input:{mode:'teach',concept:'澄芽',content:'一起喝茶的时光'}},token);
 assert.equal(r.data.provider.wording,'api-generated-response');
 assert.doesNotMatch(r.data.message,/[?？]/u);
 assert.equal(r.data.state.profiles['learner-a'].memories[0].content,'一起喝茶的时光');
});
test('profile reset and session deletion remove the stored state',async t=>{const {call,session,dataDir,base}=await setup(t);const token=await session();await call('/api/turn',{input:{mode:'teach',concept:'tavi',content:'forget me'}},token);await call('/api/profile',{profile:'learner-a',reset:true},token);assert.equal((await call('/api/state',undefined,token)).data.state.profiles['learner-a'].memories.length,0);const r=await fetch(base+'/api/session',{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200);assert.equal((await readdir(dataDir)).length,0);});
test('backend persistence files contain hashed identifiers, not bearer tokens',async t=>{const {call,session,dataDir}=await setup(t);const token=await session();await call('/api/turn',{input:{mode:'teach',concept:'tavi',content:'persist me'}},token);const files=await readdir(dataDir);assert.equal(files.length,1);assert.ok(!files[0].includes(token));assert.ok(!(await readFile(path.join(dataDir,files[0]),'utf8')).includes(token));});
test('request size limits prevent oversized payloads',async t=>{const {call,session}=await setup(t);const token=await session();assert.equal((await call('/api/turn',{input:{mode:'chat',text:'x'.repeat(20000)}},token)).status,413);});
test('serialized concurrent turns preserve all memory writes',async t=>{const {call,session}=await setup(t);const token=await session();await Promise.all(Array.from({length:5},(_,i)=>call('/api/turn',{input:{mode:'teach',concept:`word${i}`,content:`fact${i}`}},token)));assert.equal((await call('/api/state',undefined,token)).data.state.profiles['learner-a'].memories.length,5);});

test('HTTP natural conversation uses contextual model extraction throughout the learning loop', async t => {
 const seen=[];
 const provider=new Provider({baseURL:'https://provider.invalid/v1',apiKey:'DUMMY_PROVIDER_KEY',model:'synthetic-mock'},async(url,options)=>{
  const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);let candidate={action:payload.action,text:`我记得的是 ${payload.permittedFacts?.[0] || ''}，是这样吗？`};
  if(payload.context){
   seen.push(payload);
   if(payload.text==='这里的 tavi 是大家喝茶聊天的时候')candidate={mode:'teach',concept:'tavi',content:'大家喝茶聊天的时候',topic:'Family traditions'};
   else if(payload.text.startsWith('不对'))candidate={mode:'correct',memoryId:payload.context.target.memoryId,content:'晚上相聚喝茶。'};
   else if(payload.text.startsWith('对'))candidate={mode:'confirm',memoryId:payload.context.target.memoryId};
   else candidate={mode:'ask',concept:'tavi'};
  }
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(candidate)}}]})};
 });
 const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 let last;
 for(const text of ['这里的 tavi 是大家喝茶聊天的时候','你还记得 tavi 吗？','不对，是晚上相聚喝茶。','对，就是这个意思。','tavi 是什么意思？']){
  last=await call('/api/turn',{input:{mode:'chat',text}},token);assert.equal(last.status,200);assert.equal(last.data.provider.extraction,'api-grounded-spans');
 }
 assert.equal(seen.length,5);assert.equal(seen[2].context.target.concept,'tavi');
 assert.ok(seen[2].context.recentMessages.at(-1).text.includes('大家喝茶聊天的时候'));
 const memory=last.data.state.profiles['learner-a'].memories[0];
 assert.equal(memory.content,'晚上相聚喝茶。');assert.equal(memory.topic,'Family traditions');assert.equal(memory.correctionHistory.length,1);
 assert.ok(Math.abs(memory.mastery-0.7)<1e-9);assert.deepEqual(last.data.trace.allowedKnowledge,['晚上相聚喝茶。']);
});

test('HTTP extraction context excludes other profiles and rejects references to their memories', async t => {
 let received;
 const provider={enabled:true,async extract(text,context){received=context;return {mode:'correct',memoryId:'learner-a-m1',content:'coffee moment'};},async realize(plan){return {action:plan.action,text:'Could you explain what you mean?'};}};
 const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 await call('/api/turn',{input:{mode:'teach',concept:'tavi',content:'private A meaning'}},token);
 const r=await call('/api/turn',{profile:'learner-b',input:{mode:'chat',text:'No, it means coffee moment'}},token);
 assert.equal(received.target,null);assert.deepEqual(received.memories,[]);assert.deepEqual(received.recentMessages,[]);
 assert.equal(r.data.state.profiles['learner-b'].memories.length,0);assert.equal(r.data.trace.action,'help');
});

test('provider failure falls back to natural-language rules without requiring action buttons', async t => {
 const provider={enabled:true,async extract(){throw new Error('offline');},async realize(){throw new Error('offline');}};
 const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 const r=await call('/api/turn',{input:{mode:'chat',text:'tavi means a happy moment'}},token);
 assert.equal(r.status,200);assert.equal(r.data.trace.action,'teach');assert.deepEqual(r.data.trace.allowedKnowledge,['a happy moment']);
 assert.ok(r.data.provider.extraction.includes('fallback'));
});

test('HTTP generated speech is persisted while a model memory patch is rejected', async t => {
 let unsafe=false;
 const provider={enabled:true,async realize(plan){return unsafe
  ? {action:plan.action,text:'你愿意教我吗？',memory:{content:'invented'}}
  : {action:plan.action,text:'哦，澄芽就是一起喝茶的时光呀，我理解对了吗？'};}};
 const {call,session,dataDir}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 const first=await call('/api/turn',{input:{mode:'teach',concept:'澄芽',content:'一起喝茶的时光'}},token);
 assert.equal(first.data.provider.wording,'api-generated-response');
 const saved=JSON.parse(await readFile(path.join(dataDir,(await readdir(dataDir))[0]),'utf8'));
 assert.equal(saved.state.profiles['learner-a'].history.at(-1).text,first.data.message);
 assert.equal(saved.state.profiles['learner-a'].memories[0].content,'一起喝茶的时光');
 unsafe=true;
 const second=await call('/api/turn',{input:{mode:'ask',concept:'未教过的词'}},token);
 assert.ok(second.data.provider.wording.includes('invalid-provider-output'));
 assert.equal(second.data.state.profiles['learner-a'].memories.length,1);
});

test('HTTP respects valid conversational classification without local reparsing', async t => {
 const provider={enabled:true,async extract(){return {mode:'chat'};},async realize(plan){return {action:plan.action,text:'你是在举例说明一句话，对吗？'};}};
 const {call,session}=await setup(t,{provider,accessToken:DUMMY_APP_TOKEN});const token=await session();
 const result=await call('/api/turn',{input:{mode:'chat',text:'tavi means tea is just an example sentence'}},token);
 assert.equal(result.data.provider.extraction,'api-grounded-spans');
 assert.equal(result.data.provider.wording,'api-generated-response');
 assert.equal(result.data.state.profiles['learner-a'].memories.length,0);
 assert.equal(result.data.trace.action,'help');
});
