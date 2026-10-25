"""Full REST + queue + real compute + persisted engineering artifacts."""
import argparse,json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker-node'))
from runner import Node,load_env,FILES
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5173');parser.add_argument('--cases',nargs='+',default=['beam','slider','fourbar']);args=parser.parse_args();load_env(root/'.env.node');n=Node(args.url)
evidence={}
for _ in range(30):
    catalog=n.request('GET','models')
    if catalog['models'].get('codex') and catalog['models'].get('claude'):break
    time.sleep(1)
assert len(catalog['models'].get('codex',[]))>1
assert len(catalog['models'].get('claude',[]))>1
print('Live catalogs:',{k:len(v) for k,v in catalog['models'].items()},flush=True)
for name in args.cases:
    spec=json.loads((root/'public/benchmarks'/f'{name}.json').read_text());p=n.request('POST','projects',json={'title':spec['name']})
    rejected=n.client.post('/api/projects/'+p['id']+'/jobs',json={'provider':'codex','model':'not-a-real-model','prompt':'test'})
    assert rejected.status_code==409,rejected.text
    job=n.request('POST','projects/'+p['id']+'/jobs',json={'provider':'manual','model':'','spec':spec})
    stage=None
    for _ in range(150):
        j=n.request('GET','jobs/'+job['id'])
        if j['stage']!=stage:stage=j['stage'];print(name,stage,flush=True)
        if j['status'] not in ['queued','running']:break
        time.sleep(2)
    else:raise TimeoutError('Compute task exceeded integration timeout')
    assert j['status'] in ['complete','needs_review'],j
    results=n.request('GET','artifacts/'+job['id']+'/engineering.json')
    if name=='beam':
        s=results['strength'];assert s['status']=='within_limits',s;assert s['force_balance_error']<1e-6;assert 0.16<s['max_displacement_mm']<0.21
    if name=='slider':assert results['motion']['status']=='collision';assert j['status']=='needs_review'
    if name=='fourbar':
        assert results['motion']['status']=='sampled_clear';assert all(c['constraint_residual_mm']<1e-6 for c in results['motion']['closure_checks'])
    assert results['drawings']['status']=='dimensioned_draft',results['drawings']
    for file in FILES:
        response=n.client.get('/api/artifacts/'+job['id']+'/'+file);assert response.status_code==200,(file,response.status_code)
    evidence[name]={'project_id':p['id'],'revision_id':job['id'],'job_status':j['status'],'engineering':{k:{a:b for a,b in value.items() if a!='frames'} for k,value in results.items()}}
    print(name,'PASS',j['status'],len(FILES),'artifacts',flush=True)
folder=root/'outputs';folder.mkdir(exist_ok=True);(folder/('cloud-engineering.json' if args.url.startswith('https') else 'local-engineering.json')).write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
