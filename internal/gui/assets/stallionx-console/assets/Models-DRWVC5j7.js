import{ct as e,dt as t,f as n,ft as r,ht as i,ot as a,t as o}from"./button-foQU0aMq.js";import{f as s}from"./index-Dj8WQ8uN.js";import{r as c,t as l}from"./queryKeys-Cg1GUzNP.js";import{c as u}from"./chunk-62JRHF6Z-Bpt_PcWe.js";import{n as d}from"./loader-circle-DPXyo3Z8.js";import{t as f}from"./check-BNgMTGga.js";import{t as p}from"./chevron-down-2PKloEbo.js";import{t as m}from"./copy-CyGWQ0KG.js";import{t as h}from"./eye-off-BkkWsgzB.js";import{a as g,n as _,t as v}from"./channelTypes-CGpXubsQ.js";import{n as y,t as b}from"./QueryState-Ce-0lMvl.js";import{t as x}from"./key-dnG5aBDA.js";import{t as S}from"./search-DKsPlWTM.js";import{t as C}from"./settings-C04TfwgH.js";import{i as ee,n as te,t as ne}from"./popover-C74twGnd.js";import{t as w}from"./badge--GygM21H.js";import{n as T,t as E}from"./label-BXKbZv6_.js";import{a as re,i as ie,n as ae,r as oe,t as D}from"./sheet-B4FvjfAo.js";import{t as O}from"./skeleton-CZZK5VDN.js";import{n as se}from"./WorkspaceContext-aRoxxBzY.js";import{t as k}from"./queryPresentationState-D6L9emEH.js";import{i as A,n as j,r as M,t as N}from"./tabs-DvGHSIK7.js";import{t as P}from"./CopyButton-CXT0x2UZ.js";var F=i(r(),1),I=t(),L=`api-reference-token-handoff`;function ce(){try{let e=sessionStorage.getItem(L);if(!e)return``;let t=JSON.parse(e);return typeof t?.key==`string`?t.key:``}catch(e){return console.warn(`[ApiConfigContext] unable to read token handoff:`,e),``}}var R=(0,F.createContext)(null);function le(e,t,n){return e&&e.replaceAll(`{{BASE_URL}}`,t).replaceAll(`{{API_KEY}}`,n)}function z({children:e}){let[t,n]=(0,F.useState)(ce),[r,i]=(0,F.useState)(s());(0,F.useEffect)(()=>{try{sessionStorage.removeItem(L)}catch(e){console.warn(`[ApiConfigContext] unable to clear token handoff:`,e)}},[]);let a=(0,F.useMemo)(()=>t||`YOUR_API_KEY`,[t]),o=(0,F.useMemo)(()=>r||window.location.origin,[r]),c=(0,F.useCallback)(e=>le(e,o,a),[o,a]),l=(0,F.useMemo)(()=>({apiKey:t,setApiKey:n,baseUrl:r,setBaseUrl:i,displayApiKey:a,displayBaseUrl:o,replaceCode:c}),[t,r,a,o,c]);return(0,I.jsx)(R.Provider,{value:l,children:e})}function B(){let e=(0,F.useContext)(R);if(!e)throw Error(`useApiConfig must be used within ApiConfigProvider`);return e}function V(){let{t}=e(`apiReference`),{apiKey:n,setApiKey:r,baseUrl:i,setBaseUrl:a}=B(),[s,u]=(0,F.useState)(!1),f=(0,F.useMemo)(()=>!!localStorage.getItem(`token`),[]),m=d({queryKey:l.tokens.list({scope:`api-config-bar`,page:1,page_size:50}),queryFn:async({signal:e})=>(await c(`/api/token/`,{page:1,page_size:50},{signal:e,silent:!0})).data,enabled:f}),_=k(m,{active:f}),v=_.hasData?m.data.items.filter(e=>e.status===1):[],y=e=>{r(e),u(!1)},S=n.length>0;return(0,I.jsxs)(ne,{children:[(0,I.jsxs)(ee,{render:(0,I.jsx)(o,{variant:`outline`,size:`sm`,className:`gap-2`,"aria-label":t(S?`configBar.keySet`:`configBar.setKey`)}),children:[(0,I.jsx)(x,{className:`h-3.5 w-3.5`}),(0,I.jsx)(`span`,{className:`hidden sm:inline`,children:t(S?`configBar.keySet`:`configBar.setKey`)}),S&&(0,I.jsx)(w,{className:`bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] px-1.5 py-0`,children:t(`configBar.badge`)}),(0,I.jsx)(p,{className:`h-3 w-3 text-muted-foreground`})]}),(0,I.jsx)(te,{className:`w-96`,align:`end`,children:(0,I.jsxs)(`div`,{className:`space-y-4`,children:[(0,I.jsxs)(`div`,{className:`space-y-1`,children:[(0,I.jsxs)(`h4`,{className:`text-sm font-semibold flex items-center gap-2`,children:[(0,I.jsx)(C,{className:`h-4 w-4`}),t(`configBar.title`)]}),(0,I.jsx)(`p`,{className:`text-xs text-muted-foreground`,children:t(`configBar.description`)})]}),(0,I.jsxs)(`div`,{className:`space-y-2`,children:[(0,I.jsx)(E,{htmlFor:`api-key`,className:`text-xs`,children:`API Key`}),(0,I.jsxs)(`div`,{className:`flex gap-2`,children:[(0,I.jsxs)(`div`,{className:`relative flex-1`,children:[(0,I.jsx)(T,{id:`api-key`,type:s?`text`:`password`,placeholder:`sk-...`,value:n,onChange:e=>r(e.target.value),className:`pr-9 font-mono text-xs`}),(0,I.jsx)(o,{variant:`ghost`,size:`icon-xs`,className:`absolute right-1 top-1/2 -translate-y-1/2`,onClick:()=>u(!s),children:s?(0,I.jsx)(h,{className:`h-3.5 w-3.5`}):(0,I.jsx)(g,{className:`h-3.5 w-3.5`})})]}),n&&(0,I.jsx)(o,{variant:`ghost`,size:`sm`,className:`text-xs shrink-0`,onClick:()=>r(``),children:t(`configBar.clear`)})]})]}),f&&(0,I.jsxs)(`div`,{className:`space-y-2`,children:[(0,I.jsx)(E,{className:`text-xs`,children:t(`configBar.tokenPicker`)}),(0,I.jsx)(b,{..._.queryStateProps,error:m.error,onRetry:()=>m.refetch(),errorTitle:t(`configBar.tokenLoadError`),loadingFallback:(0,I.jsx)(`p`,{className:`text-xs text-muted-foreground`,children:t(`common:actions.loading`)}),children:v.length===0?(0,I.jsx)(`p`,{className:`text-xs text-muted-foreground`,children:t(`configBar.noTokens`)}):(0,I.jsx)(`div`,{className:`max-h-32 overflow-y-auto space-y-1 rounded-md border p-1`,children:v.map(e=>(0,I.jsxs)(`button`,{className:`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted transition-colors`,onClick:()=>y(e.key),children:[(0,I.jsx)(`div`,{className:`font-medium truncate`,children:e.name||`Token #${e.id}`}),(0,I.jsx)(`div`,{className:`font-mono text-muted-foreground truncate`,children:e.key?`${e.key.slice(0,8)}...${e.key.slice(-4)}`:`-`})]},e.id))})})]}),(0,I.jsxs)(`div`,{className:`space-y-2`,children:[(0,I.jsx)(E,{htmlFor:`base-url`,className:`text-xs`,children:`Base URL`}),(0,I.jsx)(T,{id:`base-url`,type:`text`,placeholder:window.location.origin,value:i,onChange:e=>a(e.target.value),className:`font-mono text-xs`}),(0,I.jsx)(`p`,{className:`text-[11px] text-muted-foreground`,children:t(`configBar.baseUrlHint`)})]})]})})]})}var H=[{key:`curl`,label:`curl`},{key:`python`,label:`Python`},{key:`nodejs`,label:`Node.js`}];function U({examples:t}){let{t:n}=e(`apiReference`),{replaceCode:r}=B();return t?(0,I.jsxs)(N,{defaultValue:`curl`,className:`w-full`,children:[(0,I.jsx)(M,{className:`bg-muted/50`,children:H.map(e=>(0,I.jsx)(A,{value:e.key,className:`text-xs`,children:e.label},e.key))}),H.map(e=>{let i=r(t[e.key]||``);return(0,I.jsx)(j,{value:e.key,className:`mt-3`,children:(0,I.jsxs)(`div`,{className:`relative rounded-lg border bg-muted/30`,children:[(0,I.jsx)(`div`,{className:`absolute right-2 top-2`,children:(0,I.jsx)(P,{text:i,successMessage:n(`codeExample.copied`)})}),(0,I.jsx)(`pre`,{className:`overflow-x-auto p-4 pr-12 text-sm leading-relaxed`,children:(0,I.jsx)(`code`,{className:`font-mono text-foreground/90 whitespace-pre`,children:i||n(`codeExample.empty`)})})]})},e.key)})]}):null}function W(e,t){return a.t(e,{ns:`apiReference`,...t})}function G(e,t){let n=[];for(let[r,i]of Object.entries(v)){let a=i.filter(t=>e(t,Number(r)));if(a.length>0){let e=_[r];n.push({vendor:e?.name||t(`models.unknownVendor`),vendorColor:e?.color||``,models:a})}}return n}var K=[`dall-e-3`,`gpt-image-1`,`whisper-1`,`tts-1`,`wanx-v1`,`imagen-3`,`veo-3.1`,`cogview-4`,`kling-v1-image`,`kling-v1-video`,`kling-v2-video`,`doubao-seedance-1-0-pro-250528`,`doubao-seedance-1-0-lite-t2v`,`doubao-seedance-1-0-lite-i2v`,`doubao-seedance-1-5-pro-251215`,`doubao-seedance-2-0-260128`,`doubao-seedance-2-0-fast-260128`],q=e=>e.startsWith(`jev-`);function ue(e){return{text:G(e=>!K.includes(e)&&!q(e),e),judgment:G(q,e),image:G(e=>[`dall-e-3`,`gpt-image-1`,`wanx-v1`,`imagen-3`,`cogview-4`,`kling-v1-image`,`gemini-2.5-flash-image-preview`,`gemini-3.1-flash-image-preview`].includes(e),e),video:G(e=>e.includes(`video`)||e.includes(`veo`)||e.includes(`seedance`)||[`kling-2.0`,`kling-2.5`,`kling-2.6`,`kling-3.0`,`kling-3.0-omni`,`kling-o1`,`jimeng-3.0pro`,`hailuo-2.3`,`hailuo-2.3-fast`,`vidu-q3`,`vidu-q3-pro`,`vidu-q3-turbo`,`gv-3.1`,`gv-3.1-fast`,`hunyuan-1.5`,`mingmou-1.0`,`os-2.0`].includes(e),e),tts:G(e=>e===`tts-1`,e),stt:G(e=>e===`whisper-1`,e),embedding:[{vendor:`OpenAI`,vendorColor:_[1]?.color||``,models:[`text-embedding-3-small`,`text-embedding-3-large`,`text-embedding-ada-002`]}],none:[]}}var de=[{id:`chat-completions`,category:`text`,method:`POST`,path:`/v1/chat/completions`,titleKey:`endpoints.chatCompletions.title`,descriptionKey:`endpoints.chatCompletions.description`,isAsync:!1,modelsGroup:`text`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.chatCompletions.params.model`},{name:`messages`,type:`array`,required:!0,default:`-`,descriptionKey:`endpoints.chatCompletions.params.messages`},{name:`stream`,type:`boolean`,required:!1,default:`false`,descriptionKey:`endpoints.chatCompletions.params.stream`},{name:`temperature`,type:`number`,required:!1,default:`1.0`,descriptionKey:`endpoints.chatCompletions.params.temperature`},{name:`max_tokens`,type:`integer`,required:!1,defaultKey:`common.modelDefault`,descriptionKey:`endpoints.chatCompletions.params.maxTokens`},{name:`top_p`,type:`number`,required:!1,default:`1.0`,descriptionKey:`endpoints.chatCompletions.params.topP`},{name:`frequency_penalty`,type:`number`,required:!1,default:`0`,descriptionKey:`endpoints.chatCompletions.params.frequencyPenalty`},{name:`presence_penalty`,type:`number`,required:!1,default:`0`,descriptionKey:`endpoints.chatCompletions.params.presencePenalty`}],requestExample:{model:`gpt-5.4`,messages:[{role:`system`,content:`You are a helpful assistant.`},{role:`user`,content:`Hello! Please introduce yourself.`}],stream:!1},responseExample:{id:`chatcmpl-abc123`,object:`chat.completion`,created:1713340800,model:`gpt-5.4`,choices:[{index:0,message:{role:`assistant`,content:`Hi! I am an AI assistant, happy to help.`},finish_reason:`stop`}],usage:{prompt_tokens:25,completion_tokens:18,total_tokens:43}},codeExamples:{curl:`curl -X POST {{BASE_URL}}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello! Please introduce yourself."}
    ],
    "stream": false,
    "temperature": 0.7
  }'`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

response = client.chat.completions.create(
    model="gpt-5.4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello! Please introduce yourself."},
    ],
    stream=False,
    temperature=0.7,
)

print(response.choices[0].message.content)`,nodejs:`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const response = await client.chat.completions.create({
  model: 'gpt-5.4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello! Please introduce yourself.' },
  ],
  stream: false,
  temperature: 0.7,
});

console.log(response.choices[0].message.content);`}},{id:`messages`,category:`text`,method:`POST`,path:`/v1/messages`,titleKey:`endpoints.messages.title`,descriptionKey:`endpoints.messages.description`,isAsync:!1,modelsGroup:`text`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.messages.params.model`},{name:`max_tokens`,type:`integer`,required:!0,default:`-`,descriptionKey:`endpoints.messages.params.maxTokens`},{name:`messages`,type:`array`,required:!0,default:`-`,descriptionKey:`endpoints.messages.params.messages`},{name:`system`,type:`string | array`,required:!1,default:`-`,descriptionKey:`endpoints.messages.params.system`},{name:`stream`,type:`boolean`,required:!1,default:`false`,descriptionKey:`endpoints.messages.params.stream`},{name:`temperature`,type:`number`,required:!1,default:`1.0`,descriptionKey:`endpoints.messages.params.temperature`},{name:`top_p`,type:`number`,required:!1,defaultKey:`common.modelDefault`,descriptionKey:`endpoints.messages.params.topP`},{name:`stop_sequences`,type:`array`,required:!1,default:`-`,descriptionKey:`endpoints.messages.params.stopSequences`}],notesKeys:[`endpoints.messages.notes.auth`,`endpoints.messages.notes.baseUrl`],requestExample:{model:`claude-opus-4-7`,max_tokens:1024,messages:[{role:`user`,content:`Hello! Please introduce yourself.`}],stream:!1},responseExample:{id:`msg_01XFDUDYJgAACzvnptvVoYEL`,type:`message`,role:`assistant`,model:`claude-opus-4-7`,content:[{type:`text`,text:`Hi! I am Claude, an AI assistant made by Anthropic. How can I help you today?`}],stop_reason:`end_turn`,stop_sequence:null,usage:{input_tokens:12,output_tokens:24}},codeExamples:{curl:`curl -X POST {{BASE_URL}}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: {{API_KEY}}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello! Please introduce yourself."}
    ],
    "stream": false
  }'`,python:`# Install: pip install anthropic
import anthropic

client = anthropic.Anthropic(
    api_key="{{API_KEY}}",
    # Site root, without /v1 — the SDK appends /v1/messages itself
    base_url="{{BASE_URL}}",
)

message = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello! Please introduce yourself."},
    ],
)

# content is a list of blocks; text blocks carry the reply
print("".join(block.text for block in message.content if block.type == "text"))`,nodejs:`// Install: npm install @anthropic-ai/sdk
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: '{{API_KEY}}',
  // Site root, without /v1 — the SDK appends /v1/messages itself
  baseURL: '{{BASE_URL}}',
});

const message = await client.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Hello! Please introduce yourself.' },
  ],
});

// content is a list of blocks; text blocks carry the reply
console.log(
  message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(''),
);`}},{id:`responses`,category:`text`,method:`POST`,path:`/v1/responses`,titleKey:`endpoints.responses.title`,descriptionKey:`endpoints.responses.description`,isAsync:!1,modelsGroup:`text`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.responses.params.model`},{name:`input`,type:`string | array`,required:!0,default:`-`,descriptionKey:`endpoints.responses.params.input`},{name:`instructions`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.responses.params.instructions`},{name:`stream`,type:`boolean`,required:!1,default:`false`,descriptionKey:`endpoints.responses.params.stream`},{name:`reasoning`,type:`object`,required:!1,default:`-`,descriptionKey:`endpoints.responses.params.reasoning`},{name:`tools`,type:`array`,required:!1,default:`-`,descriptionKey:`endpoints.responses.params.tools`},{name:`tool_choice`,type:`string | object`,required:!1,default:`auto`,descriptionKey:`endpoints.responses.params.toolChoice`},{name:`parallel_tool_calls`,type:`boolean`,required:!1,default:`true`,descriptionKey:`endpoints.responses.params.parallelToolCalls`},{name:`temperature`,type:`number`,required:!1,default:`1.0`,descriptionKey:`endpoints.responses.params.temperature`},{name:`top_p`,type:`number`,required:!1,default:`1.0`,descriptionKey:`endpoints.responses.params.topP`},{name:`max_output_tokens`,type:`integer`,required:!1,default:`-`,descriptionKey:`endpoints.responses.params.maxOutputTokens`},{name:`metadata`,type:`object`,required:!1,default:`-`,descriptionKey:`endpoints.responses.params.metadata`},{name:`store`,type:`boolean`,required:!1,default:`false`,descriptionKey:`endpoints.responses.params.store`},{name:`previous_response_id`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.responses.params.previousResponseId`}],requestExample:{model:`gpt-5.4`,input:`Explain Anthropic's thinking mode in one sentence.`,reasoning:{effort:`medium`},stream:!1},responseExample:{id:`resp_abc123def456`,object:`response`,created_at:1713340800,status:`completed`,model:`gpt-5.4`,output:[{type:`reasoning`,id:`rs_xxx`,status:`completed`,content:[{type:`summary_text`,text:`The user wants a one-sentence summary, so I should focus on "let the model think within a token budget before answering".`}]},{type:`message`,id:`msg_xxx`,role:`assistant`,status:`completed`,content:[{type:`output_text`,text:`Anthropic's thinking mode lets Claude reason internally within a bounded token budget before producing the visible answer.`}]}],usage:{input_tokens:25,output_tokens:48,total_tokens:73,output_tokens_details:{reasoning_tokens:30}},parallel_tool_calls:!0,previous_response_id:null,store:!1},codeExamples:{curl:`# 1) Basic call (OpenAI model, passed through to the upstream)
curl -X POST {{BASE_URL}}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "gpt-5.4",
    "input": "Explain Anthropic thinking mode in one sentence.",
    "reasoning": {"effort": "medium"}
  }'

# 2) Cross-protocol: a Claude model, auto Responses<->Chat conversion + thinking mapping
curl -X POST {{BASE_URL}}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "claude-opus-4-7",
    "input": "Briefly explain extended thinking.",
    "reasoning": {"effort": "high"}
  }'

# 3) Structured input (multi-turn + multimodal + tool-call history)
curl -X POST {{BASE_URL}}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "gpt-5.4",
    "instructions": "You are a helpful assistant.",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {"type": "input_text", "text": "What is in this image?"},
          {"type": "input_image", "image_url": "https://example.com/cat.jpg", "detail": "high"}
        ]
      }
    ]
  }'

# 4) Function tools (supported by every protocol family)
curl -X POST {{BASE_URL}}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "gpt-5.4",
    "input": "What is the weather in San Francisco?",
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"]
        }
      }
    }]
  }'

# 5) Streaming SSE (event names: response.created / output_text.delta / completed ...)
curl -N -X POST {{BASE_URL}}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "gpt-5.4",
    "input": "Tell me a joke in 10 words or less.",
    "stream": true
  }'`,python:`# Install: pip install openai>=1.50
from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

# ============================================================
# 1) Basic call
# ============================================================
resp = client.responses.create(
    model="gpt-5.4",
    input="Explain Anthropic thinking mode in one sentence.",
    reasoning={"effort": "medium"},
)
# Pull out the message text
for item in resp.output:
    if item.type == "message":
        for part in item.content:
            if part.type == "output_text":
                print(part.text)
    elif item.type == "reasoning":
        for part in item.content:
            if part.type == "summary_text":
                print("[thinking]", part.text)

# ============================================================
# 2) Cross-protocol: the same code against Claude / Gemini, converted automatically
# ============================================================
resp = client.responses.create(
    model="claude-opus-4-7",                # routed to the Anthropic upstream
    input="Briefly explain extended thinking.",
    reasoning={"effort": "high"},           # -> thinking.budget_tokens=16384
)

resp = client.responses.create(
    model="gemini-2.5-pro",                 # routed to the Gemini upstream
    input="Briefly explain thinking budget.",
    reasoning={"effort": "low"},            # -> thinkingConfig.thinkingBudget=2048
)

# ============================================================
# 3) Structured input: multimodal + history replay
# ============================================================
resp = client.responses.create(
    model="gpt-5.4",
    instructions="You are a helpful assistant.",
    input=[
        {
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": "What is in this image?"},
                {"type": "input_image", "image_url": "https://example.com/cat.jpg",
                 "detail": "high"},
            ],
        }
    ],
)

# ============================================================
# 4) Function tool calls
# ============================================================
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]
resp = client.responses.create(
    model="gpt-5.4",
    input="What is the weather in SF?",
    tools=tools,
)
# Tool calls show up in output as function_call items:
for item in resp.output:
    if item.type == "function_call":
        print(item.name, item.arguments, item.call_id)

# ============================================================
# 5) Streaming SSE
# ============================================================
stream = client.responses.create(
    model="gpt-5.4",
    input="Tell me a joke in 10 words or less.",
    stream=True,
)
for event in stream:
    # event.type may be: response.created / response.output_text.delta /
    # response.reasoning_summary_text.delta / response.function_call_arguments.delta /
    # response.completed ...
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)
    elif event.type == "response.completed":
        print()  # newline at end of stream`,nodejs:`// Install: npm install openai@latest
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

// ============================================================
// 1) Basic call + reasoning effort
// ============================================================
const resp = await client.responses.create({
  model: 'gpt-5.4',
  input: 'Explain Anthropic thinking mode in one sentence.',
  reasoning: { effort: 'medium' },
});
for (const item of resp.output) {
  if (item.type === 'message') {
    for (const part of item.content) {
      if (part.type === 'output_text') console.log(part.text);
    }
  } else if (item.type === 'reasoning') {
    for (const part of item.content) {
      if (part.type === 'summary_text') console.log('[thinking]', part.text);
    }
  }
}

// ============================================================
// 2) Cross-protocol: just switch the model
// ============================================================
await client.responses.create({
  model: 'claude-opus-4-7',
  input: 'Briefly explain extended thinking.',
  reasoning: { effort: 'high' },
});

await client.responses.create({
  model: 'gemini-2.5-pro',
  input: 'Briefly explain thinking budget.',
  reasoning: { effort: 'low' },
});

// ============================================================
// 3) Structured input + function tools
// ============================================================
const withTool = await client.responses.create({
  model: 'gpt-5.4',
  instructions: 'You are a helpful assistant.',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'What is the weather in SF?' }],
    },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    },
  ],
});
for (const item of withTool.output) {
  if (item.type === 'function_call') {
    console.log(item.name, item.arguments, item.call_id);
  }
}

// ============================================================
// 4) Streaming SSE
// ============================================================
const stream = await client.responses.create({
  model: 'gpt-5.4',
  input: 'Tell me a joke in 10 words or less.',
  stream: true,
});
for await (const event of stream) {
  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'response.completed') {
    process.stdout.write('\\n');
  }
}`}},{id:`responses-compact`,category:`text`,method:`POST`,path:`/v1/responses/compact`,titleKey:`endpoints.responsesCompact.title`,descriptionKey:`endpoints.responsesCompact.description`,isAsync:!1,modelsGroup:`text`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.responsesCompact.params.model`},{name:`input`,type:`string | array`,required:!0,default:`-`,descriptionKey:`endpoints.responsesCompact.params.input`},{name:`instructions`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.responsesCompact.params.instructions`},{name:`previous_response_id`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.responsesCompact.params.previousResponseId`},{name:`prompt_cache_key`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.responsesCompact.params.promptCacheKey`}],requestExample:{model:`gpt-5.4`,instructions:`You are a helpful assistant.`,input:[{type:`message`,role:`user`,content:[{type:`input_text`,text:`Summarize our discussion so far.`}]},{type:`message`,role:`assistant`,content:[{type:`output_text`,text:`We covered the migration plan and the rollout order.`}]}]},responseExample:{id:`resp_x`,object:`response.compaction`,created_at:17568e5,output:[{type:`message`,role:`user`,content:[{type:`input_text`,text:`...`}]},{type:`compaction`,id:`cmp_x`,encrypted_content:`gAAAA...`}],usage:{input_tokens:1240,output_tokens:310,total_tokens:1550}},codeExamples:{curl:`# Compact a long conversation into a compaction item (always non-streaming JSON)
curl -X POST {{BASE_URL}}/v1/responses/compact \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "gpt-5.4",
    "instructions": "You are a helpful assistant.",
    "input": [
      {"type": "message", "role": "user",
       "content": [{"type": "input_text", "text": "Summarize our discussion so far."}]},
      {"type": "message", "role": "assistant",
       "content": [{"type": "output_text", "text": "We covered the migration plan and the rollout order."}]}
    ]
  }'

# Then reuse the returned compaction item as input on the next /v1/responses call:
#   "input": [{"type": "compaction", "id": "cmp_x", "encrypted_content": "gAAAA..."},
#             {"type": "message", "role": "user", "content": "What did we decide about rollout?"}]`,python:`# Install: pip install openai>=1.50
import requests
from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

history = [
    {"type": "message", "role": "user",
     "content": [{"type": "input_text", "text": "Summarize our discussion so far."}]},
    {"type": "message", "role": "assistant",
     "content": [{"type": "output_text", "text": "We covered the migration plan and the rollout order."}]},
]

# 1) Compact the conversation (plain HTTP; the response is always non-streaming JSON)
resp = requests.post(
    "{{BASE_URL}}/v1/responses/compact",
    headers={"Authorization": "Bearer {{API_KEY}}", "Content-Type": "application/json"},
    json={"model": "gpt-5.4", "instructions": "You are a helpful assistant.", "input": history},
    timeout=120,
)
resp.raise_for_status()
compacted = resp.json()
print(compacted["object"], compacted["usage"])   # response.compaction {...}

# 2) Continue the session with the compaction item instead of the full history
compaction_items = [item for item in compacted["output"] if item["type"] == "compaction"]
follow_up = client.responses.create(
    model="gpt-5.4",
    input=compaction_items + [
        {"type": "message", "role": "user", "content": "What did we decide about rollout?"},
    ],
)
print(follow_up.output_text)`,nodejs:`// Install: npm install openai@latest
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const history = [
  { type: 'message', role: 'user',
    content: [{ type: 'input_text', text: 'Summarize our discussion so far.' }] },
  { type: 'message', role: 'assistant',
    content: [{ type: 'output_text', text: 'We covered the migration plan and the rollout order.' }] },
];

// 1) Compact the conversation (plain fetch; the response is always non-streaming JSON)
const res = await fetch('{{BASE_URL}}/v1/responses/compact', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer {{API_KEY}}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-5.4',
    instructions: 'You are a helpful assistant.',
    input: history,
  }),
});
if (!res.ok) throw new Error(\`compact failed: \${res.status}\`);
const compacted = await res.json();
console.log(compacted.object, compacted.usage); // response.compaction {...}

// 2) Continue the session with the compaction item instead of the full history
const compactionItems = compacted.output.filter((item) => item.type === 'compaction');
const followUp = await client.responses.create({
  model: 'gpt-5.4',
  input: [
    ...compactionItems,
    { type: 'message', role: 'user', content: 'What did we decide about rollout?' },
  ],
});
console.log(followUp.output_text);`}},{id:`images-generations`,category:`image`,method:`POST`,path:`/v1/images/generations`,titleKey:`endpoints.imagesGenerations.title`,descriptionKey:`endpoints.imagesGenerations.description`,isAsync:!1,modelsGroup:`image`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.imagesGenerations.params.model`},{name:`prompt`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.imagesGenerations.params.prompt`},{name:`n`,type:`integer`,required:!1,default:`1`,descriptionKey:`endpoints.imagesGenerations.params.n`},{name:`size`,type:`string`,required:!1,default:`"1024x1024"`,descriptionKey:`endpoints.imagesGenerations.params.size`},{name:`quality`,type:`string`,required:!1,default:`"standard"`,descriptionKey:`endpoints.imagesGenerations.params.quality`},{name:`response_format`,type:`string`,required:!1,default:`"url"`,descriptionKey:`endpoints.imagesGenerations.params.responseFormat`}],requestExample:{model:`dall-e-3`,prompt:`A horse galloping under a starry sky, digital art style`,n:1,size:`1024x1024`,quality:`standard`},responseExample:{created:1713340800,data:[{url:`https://example.com/generated-image.png`,revised_prompt:`A horse galloping beneath a star-filled night sky...`}]},codeExamples:{curl:`curl -X POST {{BASE_URL}}/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "dall-e-3",
    "prompt": "A horse galloping under a starry sky, digital art style",
    "n": 1,
    "size": "1024x1024"
  }'`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

response = client.images.generate(
    model="dall-e-3",
    prompt="A horse galloping under a starry sky, digital art style",
    n=1,
    size="1024x1024",
)

print(response.data[0].url)`,nodejs:`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const response = await client.images.generate({
  model: 'dall-e-3',
  prompt: 'A horse galloping under a starry sky, digital art style',
  n: 1,
  size: '1024x1024',
});

console.log(response.data[0].url);`}},{id:`images-edits`,category:`image`,method:`POST`,path:`/v1/images/edits`,titleKey:`endpoints.imagesEdits.title`,descriptionKey:`endpoints.imagesEdits.description`,isAsync:!1,modelsGroup:`image`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.imagesEdits.params.model`},{name:`prompt`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.imagesEdits.params.prompt`},{name:`image`,type:`file | string`,required:!0,default:`-`,descriptionKey:`endpoints.imagesEdits.params.image`},{name:`mask`,type:`file`,required:!1,default:`-`,descriptionKey:`endpoints.imagesEdits.params.mask`},{name:`n`,type:`integer`,required:!1,default:`1`,descriptionKey:`endpoints.imagesEdits.params.n`},{name:`size`,type:`string`,required:!1,default:`"1024x1024"`,descriptionKey:`endpoints.imagesEdits.params.size`},{name:`response_format`,type:`string`,required:!1,default:`"url"`,descriptionKey:`endpoints.imagesEdits.params.responseFormat`},{name:`quality`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.imagesEdits.params.quality`},{name:`background`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.imagesEdits.params.background`}],playground:{kind:`image-edit`,driver:`image-edit`,fileField:`image`,fields:[{name:`n`,type:`number`,labelKey:`endpoints.imagesEdits.playground.fields.n`,min:1,max:10,step:1,defaultValue:1},{name:`size`,type:`text`,labelKey:`endpoints.imagesEdits.playground.fields.size`,placeholder:`1024x1024`},{name:`response_format`,type:`select`,labelKey:`endpoints.imagesEdits.playground.fields.responseFormat`,options:[`url`,`b64_json`],defaultValue:`url`},{name:`quality`,type:`text`,labelKey:`endpoints.imagesEdits.playground.fields.quality`,placeholder:`standard / hd`},{name:`background`,type:`select`,labelKey:`endpoints.imagesEdits.playground.fields.background`,options:[``,`transparent`,`opaque`,`auto`]}]},requestExample:{model:`gpt-image-2`,prompt:`Replace the background with a blue sky and white clouds`,image:`https://example.com/original.png`},responseExample:{created:1713340800,data:[{url:`https://example.com/edited-image.png`}]},codeExamples:{curl:`# multipart file upload
curl -X POST {{BASE_URL}}/v1/images/edits \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -F "model=gpt-image-2" \\
  -F "prompt=Replace the background with a blue sky and white clouds" \\
  -F "image=@./original.png"

# JSON body with an image URL
curl -X POST {{BASE_URL}}/v1/images/edits \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seedream-3-i2i",
    "prompt": "Replace the background with a blue sky and white clouds",
    "image": "https://example.com/original.png"
  }'`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

# multipart file upload
with open("original.png", "rb") as img_file:
    response = client.images.edit(
        model="gpt-image-2",
        image=img_file,
        prompt="Replace the background with a blue sky and white clouds",
    )

print(response.data[0].url)`,nodejs:`import OpenAI from 'openai';
import fs from 'fs';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

// multipart file upload
const response = await client.images.edit({
  model: 'gpt-image-2',
  image: fs.createReadStream('original.png'),
  prompt: 'Replace the background with a blue sky and white clouds',
});

console.log(response.data[0].url);`},notesKeys:[`endpoints.imagesEdits.notes.openai`,`endpoints.imagesEdits.notes.volcengine`,`endpoints.imagesEdits.notes.zhipu`,`endpoints.imagesEdits.notes.gemini`,`endpoints.imagesEdits.notes.unsupportedField`]},{id:`videos-generations`,category:`video`,method:`POST`,path:`/v1/videos/generations`,titleKey:`endpoints.videosGenerations.title`,descriptionKey:`endpoints.videosGenerations.description`,isAsync:!0,modelsGroup:`video`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.videosGenerations.params.model`},{name:`prompt`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.videosGenerations.params.prompt`},{name:`image_url`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.videosGenerations.params.imageUrl`},{name:`duration`,type:`integer`,required:!1,default:`5`,descriptionKey:`endpoints.videosGenerations.params.duration`},{name:`size`,type:`string`,required:!1,default:`"1280x720"`,descriptionKey:`endpoints.videosGenerations.params.size`}],requestExample:{model:`kling-v2-video`,prompt:`A horse galloping across the grassland, slow motion, cinematic`,duration:5,size:`1280x720`},responseExample:{task_id:`task_abc123def456`,status:`pending`,model:`kling-v2-video`,created_at:`2026-04-16T12:00:00Z`},pollingResponseExample:{task_id:`task_abc123def456`,status:`completed`,model:`kling-v2-video`,data:{video_url:`https://example.com/generated-video.mp4`,duration:5,size:`1280x720`},created_at:`2026-04-16T12:00:00Z`,updated_at:`2026-04-16T12:02:30Z`},codeExamples:{curl:`# Step 1: submit the video generation task
curl -X POST {{BASE_URL}}/v1/videos/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "kling-v2-video",
    "prompt": "A horse galloping across the grassland, slow motion, cinematic",
    "duration": 5,
    "size": "1280x720"
  }'

# Step 2: poll the task status with the returned task_id
curl {{BASE_URL}}/v1/videos/task_abc123def456 \\
  -H "Authorization: Bearer {{API_KEY}}"`,python:`import time
import requests

BASE_URL = "{{BASE_URL}}"
API_KEY = "{{API_KEY}}"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

# Step 1: submit the video generation task
resp = requests.post(
    f"{BASE_URL}/v1/videos/generations",
    headers=headers,
    json={
        "model": "kling-v2-video",
        "prompt": "A horse galloping across the grassland, slow motion, cinematic",
        "duration": 5,
        "size": "1280x720",
    },
)
task_id = resp.json()["task_id"]
print(f"Task submitted: {task_id}")

# Step 2: poll the task status
while True:
    status_resp = requests.get(
        f"{BASE_URL}/v1/videos/{task_id}",
        headers=headers,
    )
    result = status_resp.json()
    print(f"Status: {result['status']}")

    if result["status"] == "completed":
        print(f"Video URL: {result['data']['video_url']}")
        break
    elif result["status"] == "failed":
        print(f"Generation failed: {result.get('error_message', 'unknown error')}")
        break

    time.sleep(10)  # poll every 10 seconds`,nodejs:`const BASE_URL = '{{BASE_URL}}';
const API_KEY = '{{API_KEY}}';

// Step 1: submit the video generation task
const submitResp = await fetch(\`\${BASE_URL}/v1/videos/generations\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${API_KEY}\`,
  },
  body: JSON.stringify({
    model: 'kling-v2-video',
    prompt: 'A horse galloping across the grassland, slow motion, cinematic',
    duration: 5,
    size: '1280x720',
  }),
});
const { task_id } = await submitResp.json();
console.log('Task submitted:', task_id);

// Step 2: poll the task status
const poll = async () => {
  while (true) {
    const resp = await fetch(\`\${BASE_URL}/v1/videos/\${task_id}\`, {
      headers: { 'Authorization': \`Bearer \${API_KEY}\` },
    });
    const result = await resp.json();
    console.log('Status:', result.status);

    if (result.status === 'completed') {
      console.log('Video URL:', result.data.video_url);
      return result;
    }
    if (result.status === 'failed') {
      throw new Error(result.error_message || 'Generation failed');
    }
    await new Promise((r) => setTimeout(r, 10000)); // 10 seconds
  }
};
await poll();`}},{id:`audio-speech`,category:`audio`,method:`POST`,path:`/v1/audio/speech`,titleKey:`endpoints.audioSpeech.title`,descriptionKey:`endpoints.audioSpeech.description`,isAsync:!1,modelsGroup:`tts`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.audioSpeech.params.model`},{name:`input`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.audioSpeech.params.input`},{name:`voice`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.audioSpeech.params.voice`},{name:`response_format`,type:`string`,required:!1,default:`"mp3"`,descriptionKey:`endpoints.audioSpeech.params.responseFormat`},{name:`speed`,type:`number`,required:!1,default:`1.0`,descriptionKey:`endpoints.audioSpeech.params.speed`}],requestExample:{model:`tts-1`,input:`Hello, welcome to the API.`,voice:`alloy`,response_format:`mp3`,speed:1},playground:{kind:`json-binary-audio`,driver:`tts`,hintKey:`endpoints.audioSpeech.playground.hint`},responseExampleKey:`endpoints.audioSpeech.responseExample`,codeExamples:{curl:`curl -X POST {{BASE_URL}}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "tts-1",
    "input": "Hello, welcome to the API.",
    "voice": "alloy"
  }' \\
  --output speech.mp3`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

response = client.audio.speech.create(
    model="tts-1",
    input="Hello, welcome to the API.",
    voice="alloy",
)

response.stream_to_file("speech.mp3")`,nodejs:`import OpenAI from 'openai';
import fs from 'fs';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const response = await client.audio.speech.create({
  model: 'tts-1',
  input: 'Hello, welcome to the API.',
  voice: 'alloy',
});

const buffer = Buffer.from(await response.arrayBuffer());
fs.writeFileSync('speech.mp3', buffer);`}},{id:`audio-transcriptions`,category:`audio`,method:`POST`,path:`/v1/audio/transcriptions`,titleKey:`endpoints.audioTranscriptions.title`,descriptionKey:`endpoints.audioTranscriptions.description`,isAsync:!1,modelsGroup:`stt`,params:[{name:`file`,type:`file`,required:!0,default:`-`,descriptionKey:`endpoints.audioTranscriptions.params.file`},{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.audioTranscriptions.params.model`},{name:`language`,type:`string`,required:!1,defaultKey:`common.autoDetect`,descriptionKey:`endpoints.audioTranscriptions.params.language`},{name:`prompt`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.audioTranscriptions.params.prompt`},{name:`response_format`,type:`string`,required:!1,default:`"json"`,descriptionKey:`endpoints.audioTranscriptions.params.responseFormat`},{name:`temperature`,type:`number`,required:!1,default:`0`,descriptionKey:`endpoints.audioTranscriptions.params.temperature`}],requestExampleKey:`endpoints.audioTranscriptions.requestExample`,playground:{kind:`multipart`,driver:`multipart-audio`,fileField:`file`,fields:[{name:`language`,type:`text`,labelKey:`endpoints.audioTranscriptions.playground.fields.language`,placeholderKey:`endpoints.audioTranscriptions.playground.placeholders.language`},{name:`prompt`,type:`text`,labelKey:`endpoints.audioTranscriptions.playground.fields.prompt`,placeholderKey:`endpoints.audioTranscriptions.playground.placeholders.prompt`},{name:`response_format`,type:`select`,labelKey:`endpoints.audioTranscriptions.playground.fields.responseFormat`,options:[`json`,`text`,`srt`,`verbose_json`,`vtt`],defaultValue:`json`},{name:`temperature`,type:`number`,labelKey:`endpoints.audioTranscriptions.playground.fields.temperature`,min:0,max:1,step:.1,defaultValue:0}]},responseExample:{text:`Hello, welcome to the API.`},codeExamples:{curl:`curl -X POST {{BASE_URL}}/v1/audio/transcriptions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -F "file=@audio.mp3" \\
  -F "model=whisper-1" \\
  -F "language=en"`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

with open("audio.mp3", "rb") as audio_file:
    transcript = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        language="en",
    )

print(transcript.text)`,nodejs:`import OpenAI from 'openai';
import fs from 'fs';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const transcript = await client.audio.transcriptions.create({
  model: 'whisper-1',
  file: fs.createReadStream('audio.mp3'),
  language: 'en',
});

console.log(transcript.text);`}},{id:`embeddings`,category:`embedding`,method:`POST`,path:`/v1/embeddings`,titleKey:`endpoints.embeddings.title`,descriptionKey:`endpoints.embeddings.description`,isAsync:!1,modelsGroup:`embedding`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.embeddings.params.model`},{name:`input`,type:`string | array`,required:!0,default:`-`,descriptionKey:`endpoints.embeddings.params.input`},{name:`encoding_format`,type:`string`,required:!1,default:`"float"`,descriptionKey:`endpoints.embeddings.params.encodingFormat`},{name:`dimensions`,type:`integer`,required:!1,defaultKey:`common.modelDefault`,descriptionKey:`endpoints.embeddings.params.dimensions`}],requestExample:{model:`text-embedding-3-small`,input:`Hello world`,encoding_format:`float`},responseExample:{object:`list`,data:[{object:`embedding`,embedding:[.0023064255,-.009327292,`... (1536 dimensions in total)`],index:0}],model:`text-embedding-3-small`,usage:{prompt_tokens:3,total_tokens:3}},codeExamples:{curl:`curl -X POST {{BASE_URL}}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "text-embedding-3-small",
    "input": "Hello world"
  }'`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Hello world",
)

print(f"Dimensions: {len(response.data[0].embedding)}")
print(f"First 5 values: {response.data[0].embedding[:5]}")`,nodejs:`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const response = await client.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'Hello world',
});

console.log('Dimensions:', response.data[0].embedding.length);
console.log('First 5 values:', response.data[0].embedding.slice(0, 5));`}},{id:`token-balance-new-api`,category:`billing`,method:`GET`,path:`/api/usage/token`,titleKey:`endpoints.tokenBalance.title`,descriptionKey:`endpoints.tokenBalance.description`,isAsync:!1,modelsGroup:`none`,params:[],requestExample:null,responseExample:{success:!0,code:!0,message:`ok`,data:{object:`token_usage`,name:`production-key`,total_granted:5e6,total_used:125e4,total_available:375e4,unlimited_quota:!1,model_limits:{"gpt-5.4":!0},model_limits_enabled:!0,expires_at:0,quota_scale:5e5,currency:`USD`,user_balance:2e6,user_balance_usd:4,token_quota_usd:10,token_used_usd:2.5,token_remaining_usd:7.5,period_type:``,period_quota_usd:0,period_used_usd:0,period_remaining_usd:0,token_available_usd:7.5,effective_available_usd:4}},codeExamples:{curl:`curl {{BASE_URL}}/api/usage/token   -H "Authorization: Bearer {{API_KEY}}"`,python:`import requests

response = requests.get(
    "{{BASE_URL}}/api/usage/token",
    headers={"Authorization": "Bearer {{API_KEY}}"},
    timeout=30,
)
response.raise_for_status()
data = response.json()["data"]

print("Key remaining (USD):", data["token_remaining_usd"])
print("Payment wallet (USD):", data["user_balance_usd"])
print("Effective available (USD):", data["effective_available_usd"])`,nodejs:`const response = await fetch('{{BASE_URL}}/api/usage/token', {
  headers: { Authorization: 'Bearer {{API_KEY}}' },
});

if (!response.ok) throw new Error(await response.text());
const { data } = await response.json();

console.log('Key remaining (USD):', data.token_remaining_usd);
console.log('Payment wallet (USD):', data.user_balance_usd);
console.log('Effective available (USD):', data.effective_available_usd);`}},{id:`billing-subscription`,category:`billing`,method:`GET`,path:`/dashboard/billing/subscription`,titleKey:`endpoints.billingSubscription.title`,descriptionKey:`endpoints.billingSubscription.description`,isAsync:!1,modelsGroup:`none`,params:[],requestExample:null,responseExample:{object:`billing_subscription`,has_payment_method:!0,soft_limit_usd:10,hard_limit_usd:10,system_hard_limit_usd:10,access_until:0,unlimited_quota:!1,user_balance:4,effective_available:4,user_balance_usd:4,token_quota_usd:10,token_used_usd:2.5,token_remaining_usd:7.5,period_type:``,period_quota_usd:0,period_used_usd:0,period_remaining_usd:0,token_available_usd:7.5,effective_available_usd:4,currency:`USD`},codeExamples:{curl:`curl {{BASE_URL}}/dashboard/billing/subscription   -H "Authorization: Bearer {{API_KEY}}"

# Equivalent alias: {{BASE_URL}}/v1/dashboard/billing/subscription`,python:`import requests

response = requests.get(
    "{{BASE_URL}}/dashboard/billing/subscription",
    headers={"Authorization": "Bearer {{API_KEY}}"},
    timeout=30,
)
response.raise_for_status()
subscription = response.json()

print("Key hard limit (USD):", subscription["hard_limit_usd"])
print("Payment wallet (USD):", subscription["user_balance"])`,nodejs:`const response = await fetch('{{BASE_URL}}/dashboard/billing/subscription', {
  headers: { Authorization: 'Bearer {{API_KEY}}' },
});

if (!response.ok) throw new Error(await response.text());
const subscription = await response.json();

console.log('Key hard limit (USD):', subscription.hard_limit_usd);
console.log('Payment wallet (USD):', subscription.user_balance);`}},{id:`billing-usage`,category:`billing`,method:`GET`,path:`/dashboard/billing/usage`,titleKey:`endpoints.billingUsage.title`,descriptionKey:`endpoints.billingUsage.description`,isAsync:!1,modelsGroup:`none`,params:[{name:`start_date`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.billingUsage.params.startDate`},{name:`end_date`,type:`string`,required:!1,default:`-`,descriptionKey:`endpoints.billingUsage.params.endDate`}],requestExample:null,responseExample:{object:`list`,daily_costs:[],total_usage:250,unlimited_quota:!1,user_balance:4,effective_available:4,user_balance_usd:4,token_quota_usd:10,token_used_usd:2.5,token_remaining_usd:7.5,period_type:``,period_quota_usd:0,period_used_usd:0,period_remaining_usd:0,token_available_usd:7.5,effective_available_usd:4,currency:`USD`},codeExamples:{curl:`curl "{{BASE_URL}}/dashboard/billing/usage?start_date=2026-08-01&end_date=2026-08-15"   -H "Authorization: Bearer {{API_KEY}}"

# Equivalent alias: {{BASE_URL}}/v1/dashboard/billing/usage`,python:`import requests

response = requests.get(
    "{{BASE_URL}}/dashboard/billing/usage",
    headers={"Authorization": "Bearer {{API_KEY}}"},
    params={"start_date": "2026-08-01", "end_date": "2026-08-15"},
    timeout=30,
)
response.raise_for_status()
usage = response.json()

print("Total usage (cents):", usage["total_usage"])
print("Total usage (USD):", usage["token_used_usd"])`,nodejs:`const url = new URL('{{BASE_URL}}/dashboard/billing/usage');
url.searchParams.set('start_date', '2026-08-01');
url.searchParams.set('end_date', '2026-08-15');

const response = await fetch(url, {
  headers: { Authorization: 'Bearer {{API_KEY}}' },
});
if (!response.ok) throw new Error(await response.text());

const usage = await response.json();
console.log('Total usage (cents):', usage.total_usage);
console.log('Total usage (USD):', usage.token_used_usd);`}},{id:`billing-credit-grants`,category:`billing`,method:`GET`,path:`/dashboard/billing/credit_grants`,titleKey:`endpoints.billingCreditGrants.title`,descriptionKey:`endpoints.billingCreditGrants.description`,isAsync:!1,modelsGroup:`none`,params:[],requestExample:null,responseExample:{object:`credit_summary`,total_granted:10,total_used:2.5,total_available:7.5,grants:{object:`list`,data:[],has_more:!1,total_count:0},user_balance:4,unlimited_quota:!1,effective_available:4,currency:`USD`,period_type:``,period_quota:0,period_used:0,period_remaining:0,token_available:7.5,user_balance_usd:4,token_quota_usd:10,token_used_usd:2.5,token_remaining_usd:7.5,period_quota_usd:0,period_used_usd:0,period_remaining_usd:0,token_available_usd:7.5,effective_available_usd:4},codeExamples:{curl:`curl {{BASE_URL}}/dashboard/billing/credit_grants   -H "Authorization: Bearer {{API_KEY}}"

# Equivalent alias: {{BASE_URL}}/v1/dashboard/billing/credit_grants`,python:`import requests

response = requests.get(
    "{{BASE_URL}}/dashboard/billing/credit_grants",
    headers={"Authorization": "Bearer {{API_KEY}}"},
    timeout=30,
)
response.raise_for_status()
balance = response.json()

print("Key remaining (USD):", balance["total_available"])
print("Payment wallet (USD):", balance["user_balance"])
print("Effective available (USD):", balance["effective_available"])`,nodejs:`const response = await fetch('{{BASE_URL}}/dashboard/billing/credit_grants', {
  headers: { Authorization: 'Bearer {{API_KEY}}' },
});

if (!response.ok) throw new Error(await response.text());
const balance = await response.json();

console.log('Key remaining (USD):', balance.total_available);
console.log('Payment wallet (USD):', balance.user_balance);
console.log('Effective available (USD):', balance.effective_available);`}},{id:`systemone`,category:`judgment`,method:`POST`,path:`/v1/systemone`,titleKey:`endpoints.systemone.title`,descriptionKey:`endpoints.systemone.description`,isAsync:!1,modelsGroup:`judgment`,params:[{name:`model`,type:`string`,required:!0,default:`-`,descriptionKey:`endpoints.systemone.params.model`},{name:`state`,type:`string | object | array`,required:!0,default:`-`,descriptionKey:`endpoints.systemone.params.state`},{name:`questions`,type:`object`,required:!0,default:`-`,descriptionKey:`endpoints.systemone.params.questions`}],requestExample:{model:`jev-latest`,state:`Help! My payouts have been failing for 3 days.`,questions:{is_urgent:{type:`noul`,instructions:`Does this convey urgency?`},category:{type:`choice`,instructions:`What kind of request is this?`,criteria:{billing:`Payment or payout problems`,bug:`Something is broken`,other:`Anything else`}}}},responseExample:{model:`jev-1.13.0`,answers:{is_urgent:{type:`noul`,noul:.95},category:{type:`choice`,choice:`billing`,probabilities:{billing:.91,bug:.06,other:.03},confidence:.88}},usage:{input_tokens:296,output_tokens:20}},codeExamples:{curl:`# System One is not a chat API: send a state plus typed questions,
# get back a probability / choice / score per question (always non-streaming JSON)
curl -X POST {{BASE_URL}}/v1/systemone \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "jev-latest",
    "state": "Help! My payouts have been failing for 3 days.",
    "questions": {
      "is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"},
      "category": {
        "type": "choice",
        "instructions": "What kind of request is this?",
        "criteria": {
          "billing": "Payment or payout problems",
          "bug": "Something is broken",
          "other": "Anything else"
        }
      }
    }
  }'`,python:`import requests

# System One is not a chat API: send a state plus typed questions.
# Question types: noul (yes/no probability), choice (pick one), score (rubric levels).
resp = requests.post(
    "{{BASE_URL}}/v1/systemone",
    headers={"Authorization": "Bearer {{API_KEY}}", "Content-Type": "application/json"},
    json={
        "model": "jev-latest",
        "state": "Help! My payouts have been failing for 3 days.",
        "questions": {
            "is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"},
            "category": {
                "type": "choice",
                "instructions": "What kind of request is this?",
                "criteria": {
                    "billing": "Payment or payout problems",
                    "bug": "Something is broken",
                    "other": "Anything else",
                },
            },
        },
    },
    timeout=60,
)
resp.raise_for_status()
data = resp.json()
print(data["answers"]["is_urgent"]["noul"])      # e.g. 0.95
print(data["answers"]["category"]["choice"])     # e.g. "billing"
print(data["usage"])                             # {"input_tokens": ..., "output_tokens": ...}`,nodejs:`// System One is not a chat API: send a state plus typed questions.
// Question types: noul (yes/no probability), choice (pick one), score (rubric levels).
const resp = await fetch('{{BASE_URL}}/v1/systemone', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer {{API_KEY}}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'jev-latest',
    state: 'Help! My payouts have been failing for 3 days.',
    questions: {
      is_urgent: { type: 'noul', instructions: 'Does this convey urgency?' },
      category: {
        type: 'choice',
        instructions: 'What kind of request is this?',
        criteria: {
          billing: 'Payment or payout problems',
          bug: 'Something is broken',
          other: 'Anything else',
        },
      },
    },
  }),
});

const data = await resp.json();
console.log(data.answers.is_urgent.noul);     // e.g. 0.95
console.log(data.answers.category.choice);    // e.g. "billing"
console.log(data.usage);                      // { input_tokens, output_tokens }`}},{id:`models`,category:`other`,method:`GET`,path:`/v1/models`,titleKey:`endpoints.models.title`,descriptionKey:`endpoints.models.description`,isAsync:!1,modelsGroup:`none`,params:[],requestExample:null,responseExample:{object:`list`,data:[{id:`gpt-5.4`,object:`model`,created:1713340800,owned_by:`openai`},{id:`claude-opus-4-6`,object:`model`,created:1713340800,owned_by:`anthropic`}]},codeExamples:{curl:`curl {{BASE_URL}}/v1/models \\
  -H "Authorization: Bearer {{API_KEY}}"`,python:`from openai import OpenAI

client = OpenAI(
    api_key="{{API_KEY}}",
    base_url="{{BASE_URL}}/v1",
)

models = client.models.list()
for model in models.data:
    print(model.id)`,nodejs:`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '{{API_KEY}}',
  baseURL: '{{BASE_URL}}/v1',
});

const models = await client.models.list();
for (const model of models.data) {
  console.log(model.id);
}`}}];function fe(e,t){let{descriptionKey:n,defaultKey:r,...i}=e;return{...i,default:r?t(r):i.default,description:t(n)}}function pe(e,t){let{hintKey:n,fields:r,...i}=e,a={...i};return n&&(a.hint=t(n)),r&&(a.fields=r.map(({labelKey:e,placeholderKey:n,...r})=>{let i={...r,label:t(e)};return n&&(i.placeholder=t(n)),i})),a}function me(e,t,n){let{titleKey:r,descriptionKey:i,modelsGroup:a,params:o,notesKeys:s,playground:c,requestExampleKey:l,responseExampleKey:u,...d}=e,f={...d,title:t(r),description:t(i),categoryLabel:t(`categories.${e.category}`),models:n[a]||[],params:(o||[]).map(e=>fe(e,t))};return s&&(f.notes=s.map(e=>t(e))),c&&(f.playground=pe(c,t)),l&&(f.requestExample=t(l)),u&&(f.responseExample=t(u)),f}function J(e=W){let t=ue(e);return de.map(n=>me(n,e,t))}var Y=J();a.on(`languageChanged`,()=>{Y=J()});var he={token:`default`,per_call:`secondary`,per_call_params:`outline`,per_second:`secondary`};function X(e,t){let n=he[e];return n?{label:t(`billingType.${e}`),variant:n}:{label:e,variant:`outline`}}function Z(e){if(e==null)return`-`;let t=Number(e);return Number.isFinite(t)?t===0?n(0,{digits:0}):t<.01?n(t,{digits:6}):n(t,{digits:4}):`-`}var ge={chat:`chat-completions`,messages:`messages`,responses:`responses`,completions:`chat-completions`,embed:`embeddings`,images:`images-generations`,images_edits:`images-edits`,audio_speech:`audio-speech`,audio_transcriptions:`audio-transcriptions`,videos:`videos-generations`,videos_generations:`videos-generations`,systemone:`systemone`};function _e(e){let t=e.endpoints?.length?e.endpoints:[`chat`];for(let e of t){let t=ge[e],n=Y.find(e=>e.id===t);if(n)return n}return null}function ve(e,t,n){return e?t?Object.fromEntries(Object.entries(e).map(([e,r])=>[e,r.replaceAll(t,n)])):{...e}:null}function ye(e){return e.requestExample?.model||``}function be({endpoint:t,modelName:n}){let{t:r}=e(`models`),i=ye(t),a=ve(t.codeExamples,i,n);return(0,I.jsxs)(`div`,{className:`space-y-4`,children:[(0,I.jsxs)(`div`,{className:`flex items-center gap-2 text-sm`,children:[(0,I.jsx)(`span`,{className:`rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400`,children:t.method}),(0,I.jsx)(`code`,{className:`text-xs text-muted-foreground`,children:t.path})]}),a&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`h4`,{className:`mb-2 text-sm font-medium`,children:t.isAsync?r(`codeExample.createTask`):r(`codeExample.requestExample`)}),(0,I.jsx)(U,{examples:a})]}),t.isAsync&&(0,I.jsxs)(`div`,{className:`rounded-lg border bg-muted/30 p-4`,children:[(0,I.jsx)(`h4`,{className:`mb-2 text-sm font-medium`,children:r(`codeExample.queryTaskStatus`)}),(0,I.jsxs)(`div`,{className:`flex items-center gap-2 text-sm`,children:[(0,I.jsx)(`span`,{className:`rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400`,children:`GET`}),(0,I.jsxs)(`code`,{className:`text-xs text-muted-foreground`,children:[t.path.replace(`/generations`,`/`),`{task_id}`]})]}),(0,I.jsx)(`p`,{className:`mt-2 text-xs text-muted-foreground`,children:r(`codeExample.pollingHint`)})]}),t.responseExample&&typeof t.responseExample==`object`&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`h4`,{className:`mb-2 text-sm font-medium`,children:r(`codeExample.responseExample`)}),(0,I.jsx)(`div`,{className:`rounded-lg border bg-muted/30`,children:(0,I.jsx)(`pre`,{className:`overflow-x-auto p-4 text-sm leading-relaxed`,children:(0,I.jsx)(`code`,{className:`font-mono text-foreground/90 whitespace-pre`,children:JSON.stringify(t.responseExample,null,2)})})})]})]})}function xe(){let t=se(),n=u(),{i18n:r}=e(),i=r.language.startsWith(`zh`);return(0,I.jsxs)(`div`,{className:`space-y-3 p-4 text-sm`,children:[(0,I.jsx)(`p`,{children:i?`客户端对话测试使用当前空间的 API Key，无需手动填写密钥。音频、视频和文件请求暂请使用 Web 测试台。`:`Chat testing uses a key from the current workspace without manual key setup. Use the Web playground for audio, video and file requests.`}),(0,I.jsx)(o,{onClick:()=>n(t?.teamId?`/team/${t.team.slug}/playground`:`/playground`),children:i?`打开当前空间的 Playground`:`Open workspace Playground`})]})}function Se({pricing:t}){let{t:n}=e(`models`);switch(t.billing_type){case`token`:return(0,I.jsxs)(`div`,{className:`grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm`,children:[(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.input`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.input_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillionTokens`)})]}),(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.output`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.output_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillionTokens`)})]}),t.cache_read_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.cacheRead`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.cache_read_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillion`)})]}),t.cache_creation_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.cacheWrite`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.cache_creation_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillion`)})]}),t.image_input_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.imageInput`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.image_input_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillion`)})]}),t.audio_input_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.audioInput`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.audio_input_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillion`)})]}),t.audio_output_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.audioOutput`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.audio_output_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perMillion`)})]})]});case`per_call`:case`per_call_params`:return(0,I.jsxs)(`div`,{className:`text-sm`,children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.price`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.call_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perCall`)})]});case`per_second`:return(0,I.jsxs)(`div`,{className:`text-sm`,children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:n(`pricing.price`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.per_second_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:n(`pricing.perSecond`)})]});default:return(0,I.jsx)(`div`,{className:`text-sm text-muted-foreground`,children:`-`})}}function Ce({open:t,onOpenChange:n,pricing:r}){let{t:i}=e(`models`),a=(0,F.useMemo)(()=>r?_e(r):null,[r]),o=!!a;if(!r||!a)return null;let s=X(r.billing_type,i);return(0,I.jsx)(D,{open:t,onOpenChange:n,children:(0,I.jsxs)(ae,{side:`right`,className:`flex w-full flex-col overflow-y-auto px-6 sm:max-w-2xl`,children:[(0,I.jsxs)(ie,{children:[(0,I.jsxs)(`div`,{className:`flex items-start justify-between gap-2 pr-8`,children:[(0,I.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[r.provider&&(0,I.jsx)(`p`,{className:`text-xs font-medium text-muted-foreground`,children:r.provider}),(0,I.jsx)(re,{className:`mt-0.5 text-lg`,children:r.model})]}),(0,I.jsx)(w,{variant:s.variant,className:`shrink-0`,children:s.label})]}),(0,I.jsx)(oe,{className:`sr-only`,children:i(`drawer.detailAria`,{model:r.model})})]}),(0,I.jsx)(`div`,{className:`rounded-lg bg-muted/50 p-3`,children:(0,I.jsx)(Se,{pricing:r})}),Array.isArray(r.aliases)&&r.aliases.length>0&&(0,I.jsxs)(`div`,{className:`flex flex-wrap gap-1.5`,children:[(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:i(`drawer.aliases`)}),r.aliases.map((e,t)=>(0,I.jsx)(w,{variant:`outline`,className:`px-1.5 py-0 text-xs font-normal text-muted-foreground`,children:e},t))]}),(0,I.jsxs)(N,{defaultValue:`code`,className:`flex-1`,children:[(0,I.jsxs)(`div`,{className:`flex items-center justify-between`,children:[(0,I.jsxs)(M,{children:[(0,I.jsx)(A,{value:`code`,children:i(`drawer.tabs.code`)}),o&&(0,I.jsx)(A,{value:`playground`,children:i(`drawer.tabs.playground`)})]}),(0,I.jsx)(V,{})]}),(0,I.jsx)(j,{value:`code`,className:`mt-4`,children:(0,I.jsx)(be,{endpoint:a,modelName:r.model})}),o&&(0,I.jsx)(j,{value:`playground`,className:`mt-4`,children:(0,I.jsx)(xe,{endpoint:a,modelName:r.model,transport:{mode:`direct`}})})]})]})})}var Q=`__all__`;function we({text:t}){let{t:n}=e(`models`),[r,i]=(0,F.useState)(!1);return(0,I.jsxs)(`button`,{onClick:async e=>{e.stopPropagation();try{await navigator.clipboard.writeText(t),i(!0),setTimeout(()=>i(!1),2e3)}catch(e){console.error(`[Models] failed to copy model ID:`,e)}},className:`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground`,title:n(`card.copyModelId`),children:[(0,I.jsx)(`span`,{className:`max-w-[200px] truncate`,children:t}),r?(0,I.jsx)(f,{className:`size-3 text-green-500`}):(0,I.jsx)(m,{className:`size-3`})]})}function Te({pricing:t,onClick:n}){let{t:r}=e(`models`),i=X(t.billing_type,r);return(0,I.jsxs)(`div`,{className:`group cursor-pointer rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md`,onClick:()=>n?.(t),children:[(0,I.jsxs)(`div`,{className:`mb-3`,children:[(0,I.jsxs)(`div`,{className:`flex items-start justify-between gap-2`,children:[(0,I.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[t.provider&&(0,I.jsx)(`p`,{className:`text-xs font-medium text-muted-foreground`,children:t.provider}),(0,I.jsx)(`h3`,{className:`mt-0.5 truncate text-base font-semibold text-foreground`,children:t.model})]}),(0,I.jsx)(w,{variant:i.variant,className:`shrink-0`,children:i.label})]}),(0,I.jsx)(`div`,{className:`mt-1`,children:(0,I.jsx)(we,{text:t.model})})]}),(0,I.jsx)(`div`,{className:`mb-3 rounded-lg bg-muted/50 p-3`,children:(()=>{switch(t.billing_type){case`token`:return(0,I.jsxs)(`div`,{className:`grid grid-cols-2 gap-x-4 gap-y-1 text-sm`,children:[(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:r(`pricing.input`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.input_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:r(`pricing.perMillionTokens`)})]}),(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:r(`pricing.output`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.output_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:r(`pricing.perMillionTokens`)})]}),t.cache_read_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:r(`pricing.cacheRead`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.cache_read_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:r(`pricing.perMillion`)})]}),t.cache_creation_price!=null&&(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:r(`pricing.cacheWrite`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.cache_creation_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:r(`pricing.perMillion`)})]})]});case`per_call`:case`per_call_params`:return(0,I.jsxs)(`div`,{className:`text-sm`,children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:r(`pricing.price`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.call_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:r(`pricing.perCall`)})]});case`per_second`:return(0,I.jsxs)(`div`,{className:`text-sm`,children:[(0,I.jsx)(`span`,{className:`text-muted-foreground`,children:r(`pricing.price`)}),` `,(0,I.jsx)(`span`,{className:`font-mono font-medium`,children:Z(t.per_second_price)}),(0,I.jsx)(`span`,{className:`text-xs text-muted-foreground`,children:r(`pricing.perSecond`)})]});default:return(0,I.jsx)(`div`,{className:`text-sm text-muted-foreground`,children:`-`})}})()}),Array.isArray(t.aliases)&&t.aliases.length>0&&(0,I.jsxs)(`div`,{className:`flex flex-wrap gap-1`,children:[t.aliases.slice(0,3).map((e,t)=>(0,I.jsx)(w,{variant:`outline`,className:`px-1.5 py-0 text-[10px] font-normal text-muted-foreground`,children:e},t)),t.aliases.length>3&&(0,I.jsx)(w,{variant:`outline`,className:`px-1.5 py-0 text-[10px] font-normal text-muted-foreground`,children:r(`card.moreAliases`,{count:t.aliases.length-3})})]})]})}function Ee(){return(0,I.jsxs)(`div`,{className:`rounded-xl border bg-card p-5`,children:[(0,I.jsxs)(`div`,{className:`mb-3`,children:[(0,I.jsx)(O,{className:`mb-1 h-3 w-16`}),(0,I.jsx)(O,{className:`h-5 w-40`}),(0,I.jsx)(O,{className:`mt-1.5 h-4 w-32`})]}),(0,I.jsx)(`div`,{className:`mb-3 rounded-lg bg-muted/50 p-3`,children:(0,I.jsxs)(`div`,{className:`grid grid-cols-2 gap-2`,children:[(0,I.jsx)(O,{className:`h-4 w-24`}),(0,I.jsx)(O,{className:`h-4 w-24`})]})}),(0,I.jsx)(O,{className:`h-3 w-20`})]})}function $(){let{t}=e(`models`),[n,r]=(0,F.useState)(``),[i,a]=(0,F.useState)(Q),[o,s]=(0,F.useState)(null),[u,f]=(0,F.useState)(!1),p=e=>{s(e),f(!0)},m=d({queryKey:l.models.list({scope:`public`}),queryFn:async()=>(await c(`/api/pricing/public`,null,{silent:!0})).data}),h=k(m),g=h.hasData,_=(0,F.useMemo)(()=>m.data||[],[m.data]),v=(0,F.useMemo)(()=>{let e=new Set;for(let t of _)t.provider&&e.add(t.provider);return Array.from(e).sort((e,t)=>e.localeCompare(t))},[_]),x=(0,F.useMemo)(()=>{let e=_;if(i!==Q&&(e=e.filter(e=>e.provider===i)),n.trim()){let t=n.trim().toLowerCase();e=e.filter(e=>e.model?.toLowerCase().includes(t)?!0:Array.isArray(e.aliases)?e.aliases.some(e=>String(e).toLowerCase().includes(t)):!1)}return e},[_,i,n]),C=(0,F.useMemo)(()=>{let e={};for(let t of _){let n=t.provider||`Unknown`;e[n]=(e[n]||0)+1}return e},[_]);return(0,I.jsx)(z,{children:(0,I.jsxs)(`div`,{className:`space-y-6`,children:[(0,I.jsxs)(`div`,{children:[(0,I.jsx)(`h1`,{className:`text-xl md:text-2xl font-bold tracking-tight`,children:t(`title`)}),(0,I.jsxs)(`p`,{className:`text-muted-foreground`,children:[t(`description`),g&&(0,I.jsx)(`span`,{className:`ml-1 font-medium text-foreground`,children:t(`modelCount`,{count:_.length})})]})]}),(0,I.jsxs)(`div`,{className:`relative max-w-md`,children:[(0,I.jsx)(S,{className:`absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground`}),(0,I.jsx)(T,{placeholder:t(`search.placeholder`),value:n,onChange:e=>r(e.target.value),className:`pl-9`})]}),v.length>0&&(0,I.jsxs)(`div`,{className:`flex flex-wrap gap-2`,children:[(0,I.jsxs)(`button`,{onClick:()=>a(Q),className:`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${i===Q?`bg-foreground text-background`:`bg-muted text-muted-foreground hover:text-foreground`}`,children:[t(`filters.all`),(0,I.jsx)(`span`,{className:`ml-1 text-xs opacity-70`,children:_.length})]}),v.map(e=>(0,I.jsxs)(`button`,{onClick:()=>a(e),className:`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${i===e?`bg-foreground text-background`:`bg-muted text-muted-foreground hover:text-foreground`}`,children:[e,(0,I.jsx)(`span`,{className:`ml-1 text-xs opacity-70`,children:C[e]||0})]},e))]}),(0,I.jsx)(b,{...h.queryStateProps,error:m.error,onRetry:()=>m.refetch(),empty:g&&_.length===0,emptyTitle:t(`empty.noPricingTitle`),emptyDescription:t(`empty.noPricingDescription`),emptySurface:`panel`,loadingFallback:(0,I.jsx)(`div`,{className:`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`,children:Array.from({length:9}).map((e,t)=>(0,I.jsx)(Ee,{},t))}),children:x.length===0?(0,I.jsx)(y,{title:t(`empty.notFoundTitle`),description:t(n?`empty.notFoundSearch`:`empty.notFoundProvider`)}):(0,I.jsx)(`div`,{className:`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`,children:x.map(e=>(0,I.jsx)(Te,{pricing:e,onClick:p},e.id))})}),(0,I.jsx)(Ce,{open:u,onOpenChange:f,pricing:o})]})})}export{$ as ModelsContent,$ as default};