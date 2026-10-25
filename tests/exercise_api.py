"""Integration check against an actual running local or hosted service."""
import argparse, json, os, sys, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker-node'))
from runner import load_env, Node
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5173');parser.add_argument('--provider',default='manual');args=parser.parse_args();root=Path(__file__).resolve().parents[1];load_env(root/'.env.node');n=Node(args.url)
import httpx
r=httpx.get(args.url+'/api/state',follow_redirects=False)
assert r.status_code in (401,302,303,307),r.status_code
print('Anonymous API rejected:',r.status_code,flush=True)
n.heartbeat();p=n.request('POST','projects',json={'title':('API QA · образец' if args.provider=='manual' else ('Astra' if args.provider=='codex' else 'Claude')+' · корпус датчика')})
spec=json.loads((root/'public/example-spec.json').read_text())
body={'provider':args.provider,'model':'gpt-6-astra' if args.provider=='codex' else 'opus' if args.provider=='claude' else '', 'prompt':'Спроектируй корпус датчика для FDM-печати из PETG: внешний габарит основания 80×50×25 мм, стенки и дно 3 мм. Открытая сверху коробка. Отдельная плоская крышка толщиной 3 мм, габаритом 80×50 мм, расположена на 1 мм выше верхней грани основания, без пересечений. Два отдельных компонента: основание и крышка. Без крепежа и защёлок — перечисли это как незавершённое конструктивное решение в assumptions. Только коробки add/cut, без фасок. expected_solids=2, bounds=[80,50,29].'}
if args.provider=='manual':body['spec']=spec
job=n.request('POST','projects/'+p['id']+'/jobs',json=body)
print('Project:',p['id'],'Job:',job['id'],flush=True)
# A second active task must be rejected atomically.
r=n.client.post('/api/projects/'+p['id']+'/jobs',json=body);assert r.status_code==409,r.text
print('Concurrent project job rejected:',r.status_code,flush=True)
for _ in range(130):
    j=n.request('GET','jobs/'+job['id'])
    if j['status'] not in ('queued','running'):break
    time.sleep(3)
else:raise TimeoutError('CAD integration job did not finish')
print('Final status:',j['status'],j['stage'],j.get('error'),flush=True)
assert j['status']=='complete',j
result=n.request('GET','projects/'+p['id']);assert result['project']['current_revision']==job['id']
rev=result['revisions'][0];report=json.loads(rev['report']);assert report['passed'];print('Checks:',len(report['checks']),'Solids:',report['solids'],flush=True)
for f in ['model.step','model.stl','mesh.json','spec.json','report.json','source.py','drawing.svg','parts.zip','bom.csv']:
    r=n.client.get('/api/artifacts/'+job['id']+'/'+f);assert r.status_code==200,(f,r.status_code);assert len(r.content)>20
print('All 9 artifacts retrieved',flush=True)
out=root/'worker-data'/'integration';out.mkdir(parents=True,exist_ok=True);(out/(args.provider+'-result.json')).write_text(json.dumps({'project_id':p['id'],'job_id':job['id'],'revision':rev},ensure_ascii=False,indent=2))
