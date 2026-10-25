"""MCP stdio bridge. Uses the same authenticated API as the web UI."""
import json, os, sys
from pathlib import Path
import httpx
from runner import load_env
folder=Path(os.environ.get('FORMA_DATA_DIR',Path(__file__).resolve().parent.parent/'forma-data'))
if not os.environ.get('FORMA_WORKER_TOKEN') and (folder/'.worker-token').exists():os.environ['FORMA_WORKER_TOKEN']=(folder/'.worker-token').read_text().strip()
HEADERS={'Authorization':'Bearer '+(os.environ.get('FORMA_AGENT_TOKEN') or os.environ.get('FORMA_WORKER_TOKEN',''))}
client=httpx.Client(base_url=os.environ.get('FORMA_URL','http://localhost:5173'),headers=HEADERS,timeout=30)
TOOLS=[{'name':'forma_list_projects','description':'Список CAD-проектов и состояние вычислительного узла.','inputSchema':{'type':'object','properties':{},'additionalProperties':False}}, {'name':'forma_create_project','description':'Создать инженерный проект.','inputSchema':{'type':'object','properties':{'title':{'type':'string'}},'required':['title'],'additionalProperties':False}}, {'name':'forma_get_project','description':'Получить версии, CAD-спецификацию и проверки проекта.','inputSchema':{'type':'object','properties':{'project_id':{'type':'string'}},'required':['project_id'],'additionalProperties':False}}, {'name':'forma_build','description':'Построить деталь или сборку из декларативной CAD-спецификации. Получи JSON Schema через forma_spec_schema. Задача асинхронная; проверь forma_get_job.','inputSchema':{'type':'object','properties':{'project_id':{'type':'string'},'spec':{'type':'object'}},'required':['project_id','spec'],'additionalProperties':False}}, {'name':'forma_get_job','description':'Статус асинхронного CAD-построения.','inputSchema':{'type':'object','properties':{'job_id':{'type':'string'}},'required':['job_id'],'additionalProperties':False}}, {'name':'forma_spec_schema','description':'Полная JSON Schema поддерживаемых CAD-операций и сборок.','inputSchema':{'type':'object','properties':{},'additionalProperties':False}}]
TOOLS += [
 {'name':'forma_list_models','description':'Живой каталог моделей Codex, Claude и совместимого API с отметками проверенных запросов.','inputSchema':{'type':'object','properties':{},'additionalProperties':False}},
 {'name':'forma_get_engineering','description':'Результаты прочности, проверки движения и размерных чертежей сохранённой версии. Статус геометрии не является производственным допуском.','inputSchema':{'type':'object','properties':{'revision_id':{'type':'string'},'include_frames':{'type':'boolean'}},'required':['revision_id'],'additionalProperties':False}}
]
def api(method,path,body=None):
    r=client.request(method,'/api/'+path,json=body);r.raise_for_status();return r.json()
def dispatch(msg):
    method=msg.get('method');params=msg.get('params',{})
    if method=='initialize':return {'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'forma-engineering','version':'0.3.0'}}
    if method=='ping':return {}
    if method=='tools/list':return {'tools':TOOLS}
    if method=='tools/call':
        name=params['name'];args=params.get('arguments',{})
        if name=='forma_list_projects':value=api('GET','state')
        elif name=='forma_create_project':value=api('POST','projects',{'title':args['title']})
        elif name=='forma_get_project':value=api('GET','projects/'+args['project_id'])
        elif name=='forma_get_job':value=api('GET','jobs/'+args['job_id'])
        elif name=='forma_list_models':value=api('GET','models')
        elif name=='forma_get_engineering':
            value=api('GET','artifacts/'+args['revision_id']+'/engineering.json')
            if not args.get('include_frames'):value.get('motion',{}).pop('frames',None)
        elif name=='forma_spec_schema':
            from cad import Spec
            value=Spec.model_json_schema()
        elif name=='forma_build':
            from cad import Spec
            spec=Spec.model_validate(args['spec']).model_dump();value=api('POST','projects/'+args['project_id']+'/jobs',{'provider':'manual','model':'','spec':spec})
        else:raise ValueError('Unknown tool')
        return {'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False)}]}
    raise ValueError('Unknown method')
if __name__=='__main__':
    for line in sys.stdin:
        try:
            message=json.loads(line)
            if 'id' not in message:continue
            try:response={'jsonrpc':'2.0','id':message['id'],'result':dispatch(message)}
            except Exception as e:response={'jsonrpc':'2.0','id':message['id'],'error':{'code':-32603,'message':str(e)[:500]}}
            print(json.dumps(response,ensure_ascii=False),flush=True)
        except json.JSONDecodeError:continue
