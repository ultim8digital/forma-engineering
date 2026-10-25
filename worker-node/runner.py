"""Owner-controlled compute node for FORMA. Tokens stay on this machine."""
import argparse, hashlib, json, os, platform, shutil, signal, subprocess, sys, tempfile, time, threading
from pathlib import Path
import httpx
from cad import Spec
ROOT=Path(__file__).resolve().parent.parent
FILES=['model.step','model.stl','mesh.json','spec.json','report.json','source.py','drawing.svg','parts.zip','bom.csv','engineering.json','strength-mesh.json','drawings.pdf','drawings.zip']
SYSTEM='''Ты инженерный CAD-планировщик FORMA. Верни только один JSON по приложенной схеме. Не вызывай инструменты, не читай файлы, не выполняй команды. Единицы: мм, правосторонняя система XYZ. Box at — нижний угол, cylinder at — центр начального сечения, height вдоль положительной axis. extrude points в координатах плоскости, затем at. Компоненты строятся локально, повороты XYZ в градусах вокруг начала, затем перенос at. Одна физическая деталь = один компонент и одно связное тело. quantity всегда 1; повторы моделируй отдельными компонентами. Сборку не объединять в одно тело. Укажи материал и оборудование каждого компонента. Требуемые зазоры должны присутствовать в геометрии. Вся геометрия только через доступные операции: box/cylinder/extrude/fillet/chamfer. Не изображай резьбы, зубчатые профили, подшипники и другие точные элементы упрощёнными цилиндрами без явного перечисления в missing_geometry. Если геометрия не выражается этими операциями — перечисли недостающие элементы в missing_geometry, не заявляй готовность. Не выдумывай результаты FEA, кинематики и CAM. Неизвестные размеры и нагрузки явно перечисляй в assumptions. requirements.bounds = ожидаемые габариты XYZ либо null, если не заданы; expected_solids = число физических тел. tolerance — допуск проверки геометрии, а не производственный допуск. Для сложной задачи предпочитай честный частичный результат с missing_geometry. Максимум 24 компонента и 300 операций суммарно. Все поля компонентов обязательны.'''
SYSTEM+=' Свойства E, nu, предел текучести, источник материала, нагрузки, закрепления и допуски для engineering не придумывай. Если пользователь не задал эти физические исходные данные, strength и motion оставь null, допуски null. Инженерные результаты вычисляются программой, не тобой. Оси шарниров и их точки задаются в исходной системе сборки. Первая деталь в замкнутом механизме — неподвижное основание. Исходные engineering из предыдущей спецификации сохраняй без изменения.'

def load_env(path):
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key,value=line.split('=',1);os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))

def clean_json(raw):
    raw=raw.strip()
    if raw.startswith('```'): raw=raw.split('\n',1)[1].rsplit('```',1)[0]
    start=raw.find('{');end=raw.rfind('}')
    if start<0 or end<start: raise ValueError('Модель не вернула JSON-спецификацию')
    return Spec.model_validate(json.loads(raw[start:end+1])).model_dump()

def run_command(cmd,prompt,cwd,timeout=300):
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=cwd,start_new_session=True)
    try: out,err=p.communicate(prompt,timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid,signal.SIGTERM)
        try:p.communicate(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.communicate()
        raise RuntimeError('Модель не ответила за 5 минут')
    except KeyboardInterrupt:
        os.killpg(p.pid,signal.SIGTERM)
        try:p.communicate(timeout=3)
        except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.communicate()
        raise
    if p.returncode: raise RuntimeError('CLI-провайдер завершился с ошибкой. Проверь вход и доступность модели. '+err[-350:])
    return out

def generate(provider,model,prompt,previous,feedback):
    schema=json.dumps(Spec.model_json_schema(),ensure_ascii=False)
    full=SYSTEM+'\nСХЕМА:\n'+schema+'\nЗАДАЧА:\n'+prompt
    if previous:full+='\nТЕКУЩАЯ СПЕЦИФИКАЦИЯ:\n'+json.dumps(previous,ensure_ascii=False)
    if feedback:full+='\nОШИБКИ ПРЕДЫДУЩЕЙ ПОПЫТКИ:\n'+feedback
    from provider_config import profile
    config=profile(provider)
    if provider in ('codex','claude'):
        with tempfile.TemporaryDirectory(prefix='forma-model-') as folder:
            if provider=='codex':
                dest=Path(folder)/'result.json'
                cmd=['codex','exec','--ignore-user-config','--skip-git-repo-check','--ephemeral','--sandbox','read-only','-C',folder,'-m',model,'-o',str(dest),'-']
                run_command(cmd,full,folder)
                if not dest.exists():raise RuntimeError('Codex не вернул финальный ответ')
                result=dest.read_text()
            else:
                cmd=['claude','-p','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','text']
                if model:cmd+=['--model',model]
                result=run_command(cmd,full,folder)
    elif provider in ('api','local'):
        base=config.get('base_url','').rstrip('/')
        if not base:raise RuntimeError('Адрес API модели не настроен')
        headers={}
        if config.get('api_key'):headers['Authorization']='Bearer '+config['api_key']
        with httpx.Client(timeout=300) as c:
            r=c.post(base+'/chat/completions',headers=headers,json={'model':model or config.get('model',''),'messages':[{'role':'system','content':SYSTEM},{'role':'user','content':full}],'temperature':0.1});r.raise_for_status();result=r.json()['choices'][0]['message']['content']
    else:raise ValueError('Неизвестный провайдер')
    return clean_json(result)

class Node:
    def __init__(self,url):
        headers={'Authorization':'Bearer '+os.environ['FORMA_WORKER_TOKEN']}
        self.client=httpx.Client(base_url=url.rstrip('/'),headers=headers,timeout=60,follow_redirects=False)
        self.id=hashlib.sha256(platform.node().encode()).hexdigest()[:16]
        self.catalog=None;self.catalog_at=0;self.catalog_lock=threading.Lock()
    def request(self,method,path,**kwargs):
        r=self.client.request(method,'/api/'+path,**kwargs)
        if r.is_redirect:raise RuntimeError('Локальный сервер вернул неожиданный редирект.')
        r.raise_for_status();return r.json()
    def heartbeat(self):
        from provider_config import read_config
        config=read_config()
        providers=[p for p in ['codex','claude'] if config.get(p,{}).get('enabled') and shutil.which(p)]
        providers += [p for p in ['api','local'] if config.get(p,{}).get('enabled') and config[p].get('base_url')]
        state=self.request('POST','worker/heartbeat',json={'id':self.id,'name':'Локальный CAD-узел','capabilities':{'providers':providers,'cad':'CadQuery '+__import__('cadquery').__version__,'engineering_version':2,'catalog':self.catalog}})
        if state.get('refresh_models'):threading.Thread(target=self.refresh_catalog,daemon=True).start()
    def refresh_catalog(self):
        if not self.catalog_lock.acquire(blocking=False):return
        try:
            from models import discover_models
            self.catalog=discover_models();self.catalog_at=time.monotonic()
        finally:self.catalog_lock.release()
    def process(self,job):
        started=time.monotonic();lease={'X-Job-Lease':job['lease']};base='worker/jobs/'+job['id'];feedback='';spec=None;report=None
        try:
            previous=json.loads(job['input_spec']) if job.get('input_spec') else None
            count=1 if job['provider']=='manual' else 3
            for attempt in range(1,count+1):
                self.heartbeat();self.request('POST',base+'/stage',headers=lease,json={'stage':f'Проектирование · попытка {attempt}' if job['provider']!='manual' else 'Построение по параметрам'})
                try:
                    if job['provider']!='manual' and self.catalog and not any(m['id']==job['model'] for m in self.catalog['models'].get(job['provider'],[])):
                        raise ValueError('Выбранная модель отсутствует в текущем каталоге провайдера. Обнови список моделей.')
                    spec=Spec.model_validate(previous).model_dump() if job['provider']=='manual' else generate(job['provider'],job['model'],job['prompt'],previous,feedback)
                    # Engineering boundary conditions and tolerances are owner inputs.
                    # A design model may not rewrite them to make its checks turn green.
                    if previous and previous.get('engineering') is not None:
                        spec['engineering']=previous['engineering']
                    target=Path(os.environ.get('FORMA_WORK_DIR',ROOT/'forma-data/cad-work'))/job['id']/str(attempt);target.mkdir(parents=True,exist_ok=True);(target/'input.json').write_text(json.dumps(spec,ensure_ascii=False))
                    self.request('POST',base+'/stage',headers=lease,json={'stage':'Построение B-Rep и проверка сборки'})
                    # Kernel has a process-level timeout. No generated Python is executed.
                    run_command([sys.executable,str(Path(__file__).with_name('cad.py')),str(target/'input.json'),str(target)],'',str(ROOT),timeout=300)
                    report=json.loads((target/'report.json').read_text())
                    if report['passed'] or attempt==count:break
                    feedback=json.dumps([c for c in report['checks'] if not c['passed']],ensure_ascii=False);previous=spec
                except Exception as e:
                    feedback=str(e)[:2000]
                    if attempt==count:raise
            if spec is None or report is None:raise ValueError('Нет результата CAD')
            self.request('POST',base+'/stage',headers=lease,json={'stage':'Сохранение моделей и спецификации'})
            for name in FILES:self.request('PUT',base+'/artifacts/'+name,headers=lease,content=(target/name).read_bytes())
            self.request('POST',base+'/finish',headers=lease,json={'spec':spec,'report':report,'provenance':{'provider':job['provider'],'model':job['model'] if job['provider']!='manual' else 'deterministic-cad','attempts':attempt,'elapsed_seconds':round(time.monotonic()-started,2)}})
            if job['provider']!='manual' and self.catalog:
                for model in self.catalog['models'].get(job['provider'],[]):
                    if model['id']==job['model']:model['availability']='verified';model['verified_at']=int(time.time()*1000)
            print(f"Finished {job['id']}: geometry passed={report['passed']}",flush=True)
        except Exception as e:
            print(f"Failed {job['id']}: {type(e).__name__}: {str(e)[:300]}",flush=True)
            try:self.request('POST',base+'/fail',headers=lease,json={'error':str(e)[:1400]})
            except Exception:print('Could not report failure; job lease will expire.',flush=True)
    def loop(self,once=False):
        print('FORMA node connected to '+str(self.client.base_url),flush=True)
        def pulse():
            while True:
                try:
                    self.heartbeat()
                    if time.monotonic()-self.catalog_at>300:threading.Thread(target=self.refresh_catalog,daemon=True).start()
                except Exception:pass
                time.sleep(10)
        if not once:threading.Thread(target=pulse,daemon=True).start()
        else:self.refresh_catalog()
        while True:
            try:
                self.heartbeat();job=self.request('POST','worker/claim',json={}).get('job')
                if job:self.process(job)
                if once:return
                time.sleep(3)
            except KeyboardInterrupt:return
            except Exception as e:
                print('Connection error: '+type(e).__name__+': '+str(e)[:200],flush=True)
                if once:raise
                time.sleep(10)

if __name__=='__main__':
    def stop_signal(_signum,_frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop_signal)
    parser=argparse.ArgumentParser();parser.add_argument('--url');parser.add_argument('--once',action='store_true');parser.add_argument('--env');args=parser.parse_args();
    if args.env:load_env(Path(args.env))
    Node(args.url or os.environ.get('FORMA_URL','http://localhost:5173')).loop(args.once)
