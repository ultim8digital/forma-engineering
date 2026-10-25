import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder=mkdtempSync(path.join(tmpdir(),'forma-catalog-'));
const abortController=new AbortController();
const timeout=setTimeout(()=>abortController.abort(),20000);
let release;
const gate=new Promise(resolve=>{release=resolve});
async function* noTurns(){await gate;}
let session;
try{
  session=query({prompt:noTurns(),options:{cwd:folder,abortController,pathToClaudeCodeExecutable:process.env.FORMA_CLAUDE_PATH,tools:[],mcpServers:{},strictMcpConfig:true,settingSources:[],persistSession:false,settings:{disableAllHooks:true}}});
  const models=await session.supportedModels();
  console.log(JSON.stringify(models.map(m=>({id:m.value,label:m.displayName,description:m.description||'',source:'claude-supported-models',availability:'advertised'}))));
}finally{release();session?.close();clearTimeout(timeout);rmSync(folder,{recursive:true,force:true});}
