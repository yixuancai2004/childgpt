import test from 'node:test';
import assert from 'node:assert/strict';
import {Provider,validateExtracted} from '../src/llm.mjs';
import C from '../src/core.js';
import { validateRealization } from '../src/realization.mjs';
const config={baseURL:'https://provider.invalid/v1',apiKey:'DUMMY_PROVIDER_KEY_FOR_TESTS_ONLY',model:'synthetic-mock'};
const response=x=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(x)}}]})});
test('empty provider configuration sends no requests',async()=>{let calls=0;const p=new Provider({},async()=>{calls++;});assert.equal(p.enabled,false);assert.equal(await p.extract('hello'),null);assert.equal(await p.realize({action:'teach'}),null);assert.equal(calls,0);});
test('partial or insecure provider configuration rejected',()=>{assert.throws(()=>new Provider({apiKey:'x'}));assert.throws(()=>new Provider({...config,baseURL:'http://insecure.example/v1'}));assert.throws(()=>new Provider({...config,baseURL:'https://provider.invalid/v1?key=secret'}));});
test('model cannot introduce a fact absent from the reply',()=>{assert.equal(validateExtracted({mode:'teach',concept:'tavi',content:'made-up model fact'},'tavi means tea'),null);assert.equal(validateExtracted({mode:'ask',concept:'model-invented'},'What is tavi?'),null);});
test('grounded model extraction works with actual request serialization',async()=>{let req;const p=new Provider(config,async(url,options)=>{req={url,...options};return response({mode:'teach',concept:'tavi',content:'a friendly moment'});});const r=await p.extract('Please remember that tavi means a friendly moment');assert.equal(r.content,'a friendly moment');assert.equal(req.url,'https://provider.invalid/v1/chat/completions');assert.equal(req.headers.Authorization,'Bearer DUMMY_PROVIDER_KEY_FOR_TESTS_ONLY');assert.equal(JSON.parse(req.body).response_format.type,'json_object');});
test('legacy template selection is rejected as generated speech',async()=>{const p=new Provider(config,async()=>response({index:9,text:'additional knowledge'}));assert.equal(validateRealization(await p.realize({action:'teach'}),{action:'teach'}),null);});
test('provider generates a complete natural reply',async()=>{const p=new Provider(config,async()=>response({action:'teach',text:'原来你们是这样叫它的，我理解对了吗？'}));assert.equal(validateRealization(await p.realize({action:'teach'}),{action:'teach'}),'原来你们是这样叫它的，我理解对了吗？');});

test('OpenAI starter uses the supported completion budget and disables reasoning', async () => {
 let request;
 const p=new Provider({...config,baseURL:'https://api.openai.com/v1',model:'gpt-5.4-mini'},async(url,options)=>{request=JSON.parse(options.body);return response({action:'teach',text:'Did I understand you correctly?'});});
 assert.equal((await p.realize({action:'teach'})).action,'teach');
 assert.equal(request.max_completion_tokens,2048);assert.equal(request.reasoning_effort,'none');assert.equal(request.max_tokens,undefined);
});

test('Groq free-tier Qwen sends JSON with Chinese context and the supported token budget', async () => {
 const e=new C.Engine();e.transact({mode:'ask',concept:'tavi'});
 let request;
 const p=new Provider({...config,baseURL:'https://api.groq.com/openai/v1',model:'qwen/qwen3.8-27b'},async(url,options)=>{
  request={url,...JSON.parse(options.body)};
  return response({mode:'teach',concept:'tavi',content:'一起喝茶的时刻'});
 });
 const result=await p.extract('一起喝茶的时刻',C.dialogueContext(e.profile()));
 assert.equal(result.concept,'tavi');assert.equal(result.content,'一起喝茶的时刻');
 assert.equal(request.url,'https://api.groq.com/openai/v1/chat/completions');
 assert.equal(request.model,'qwen/qwen3.8-27b');assert.equal(request.response_format.type,'json_object');
 assert.equal(request.max_completion_tokens,2048);assert.equal(request.max_tokens,undefined);
 assert.equal(request.reasoning_effort,'none');
 assert.equal(request.temperature,0);
 assert.equal(JSON.parse(request.messages[1].content).context.target.concept,'tavi');
});

test('Groq quota errors propagate without retries or a different provider', async () => {
 const calls=[];
 const p=new Provider({...config,baseURL:'https://api.groq.com/openai/v1',model:'qwen/qwen3.8-27b'},async url=>{calls.push(url);return {ok:false,status:429};});
 await assert.rejects(p.extract('hello'),{message:'Provider HTTP 429.'});
 assert.deepEqual(calls,['https://api.groq.com/openai/v1/chat/completions']);
});

test('other compatible endpoints keep their existing token parameter without OpenAI-specific fields', async () => {
 let request;
 const p=new Provider(config,async(url,options)=>{request=JSON.parse(options.body);return response({action:'teach',text:'Did I understand you correctly?'});});
 await p.realize({action:'teach'});
 assert.equal(request.max_tokens,2048);assert.equal(request.max_completion_tokens,undefined);assert.equal(request.reasoning_effort,undefined);
});
test('upstream error bodies and keys never appear in errors',async()=>{const p=new Provider(config,async()=>({ok:false,status:401,text:async()=>config.apiKey}));await assert.rejects(p.extract('hello'),e=>e.message==='Provider HTTP 401.'&&!e.message.includes(config.apiKey));});
test('malformed JSON and network failure propagate for fallback',async()=>{const p=new Provider(config,async()=>({ok:true,json:async()=>({choices:[{message:{content:'not JSON'}}]})}));await assert.rejects(p.realize({action:'teach'}));const q=new Provider(config,async()=>{throw new Error('synthetic network failure');});await assert.rejects(q.extract('hello'));});

test('provider receives the current question and accepts an answer without a repeated concept', async () => {
 const e=new C.Engine();e.transact({mode:'ask',concept:'tavi'});
 const context=C.dialogueContext(e.profile());let payload;
 const p=new Provider(config,async(url,options)=>{payload=JSON.parse(JSON.parse(options.body).messages[1].content);return response({mode:'teach',concept:'tavi',content:'一起喝茶的时刻'});});
 const result=await p.extract('一起喝茶的时刻',context);
 assert.equal(result.concept,'tavi');assert.equal(result.content,'一起喝茶的时刻');
 assert.equal(payload.context.target.expectedReply,'explanation');assert.ok(payload.context.recentMessages.at(-1).text.includes('tavi'));
});

test('known memory identifiers resolve corrections but foreign identifiers and invented facts are rejected', () => {
 const e=new C.Engine();e.transact({mode:'teach',concept:'tavi',content:'tea moment'});
 const context=C.dialogueContext(e.profile());const memoryId=context.target.memoryId;
 assert.equal(validateExtracted({mode:'correct',memoryId,content:'coffee moment'},'No, it means coffee moment',context).concept,'tavi');
 assert.equal(validateExtracted({mode:'correct',memoryId:'learner-b-m1',content:'coffee moment'},'No, it means coffee moment',context),null);
 assert.equal(validateExtracted({mode:'correct',memoryId,content:'tea moment'},'No, it means coffee moment',context),null);
 assert.equal(validateExtracted({mode:'teach',concept:'invented',content:'coffee moment'},'No, it means coffee moment',context),null);
});

test('controller keeps explicit doubt pending even when the provider labels it as teaching', () => {
 const result=validateExtracted({mode:'teach',concept:'tavi',content:'morning coffee'},'I am not sure whether tavi means morning coffee');
 assert.equal(result.mode,'uncertain');
});

test('confirmation requires a current, unambiguous memory target', () => {
 assert.equal(validateExtracted({mode:'confirm',concept:'tavi'},'Yes'),null);
 const e=new C.Engine();e.transact({mode:'teach',concept:'tavi',content:'tea moment'});
 assert.equal(validateExtracted({mode:'confirm',concept:'tavi'},'Yes',C.dialogueContext(e.profile())).mode,'confirm');
 assert.equal(validateExtracted({mode:'confirm',concept:'tavi'},'Maybe yes',C.dialogueContext(e.profile())),null);
 e.transact({mode:'teach',concept:'tavi',content:'coffee moment'});
 assert.equal(validateExtracted({mode:'confirm',concept:'tavi'},'Yes',C.dialogueContext(e.profile())),null);
});
