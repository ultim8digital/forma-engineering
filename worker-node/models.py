"""Read provider-advertised models through supported authenticated clients."""
import json, os, selectors, shutil, subprocess, time
from pathlib import Path
import httpx

def codex_catalog():
    process=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
    try:
        process.stdin.write(json.dumps({'id':1,'method':'initialize','params':{'clientInfo':{'name':'forma-engineering','version':'0.2.0'}}})+'\n');process.stdin.flush()
        selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if not selector.select(1):continue
            line=process.stdout.readline()
            if not line:break
            message=json.loads(line)
            if message.get('id')==1:
                if 'error' in message:raise RuntimeError('Codex initialization failed')
                process.stdin.write(json.dumps({'method':'initialized','params':{}})+'\n'+json.dumps({'id':2,'method':'model/list','params':{'limit':100,'includeHidden':False}})+'\n');process.stdin.flush()
            if message.get('id')==2:
                if 'error' in message:raise RuntimeError('Codex model/list failed')
                return [{'id':m.get('model',m['id']),'label':m.get('displayName',m['id']),'description':m.get('description',''),'source':'codex-model/list','availability':'advertised','reasoning_efforts':[x['reasoningEffort'] for x in m.get('supportedReasoningEfforts',[])]} for m in message['result']['data'] if not m.get('hidden')]
        raise TimeoutError('Codex model discovery timed out')
    finally:
        process.terminate()
        try:process.wait(timeout=3)
        except subprocess.TimeoutExpired:process.kill();process.wait()

def claude_catalog():
    env={**os.environ,'FORMA_CLAUDE_PATH':shutil.which('claude') or ''}
    proc=subprocess.run(['node',str(Path(__file__).parent/'js/models.mjs')],capture_output=True,text=True,env=env,timeout=30)
    if proc.returncode:raise RuntimeError('Claude supportedModels unavailable; check CLI login and worker-node/js dependencies')
    return json.loads(proc.stdout)

def compatible_catalog():
    base=os.environ.get('FORMA_LLM_BASE_URL','').rstrip('/')
    if not base:return []
    headers={}
    if os.environ.get('FORMA_LLM_API_KEY'):headers['Authorization']='Bearer '+os.environ['FORMA_LLM_API_KEY']
    r=httpx.get(base+'/models',headers=headers,timeout=15);r.raise_for_status()
    return [{'id':m['id'],'label':m['id'],'description':'','source':'GET /models','availability':'advertised'} for m in r.json().get('data',[]) if isinstance(m.get('id'),str)]

def discover_models():
    from concurrent.futures import ThreadPoolExecutor
    jobs={}
    if shutil.which('codex'):jobs['codex']=codex_catalog
    if shutil.which('claude'):jobs['claude']=claude_catalog
    if os.environ.get('FORMA_LLM_BASE_URL'):jobs['compatible']=compatible_catalog
    result={};errors={}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures={name:pool.submit(fn) for name,fn in jobs.items()}
        for name,future in futures.items():
            try:result[name]=future.result()
            except Exception as e:result[name]=[];errors[name]=str(e)[:180]
    return {'models':result,'errors':errors,'discovered_at':int(time.time()*1000)}

if __name__=='__main__':print(json.dumps(discover_models(),ensure_ascii=False,indent=2))
