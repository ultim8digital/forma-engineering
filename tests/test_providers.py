"""Provider configuration and HTTP transport fixtures, not real AI inference."""
import json,sys,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker-node'))
from models import discover_models
from runner import generate

def configure(tmp_path,monkeypatch,value):
    filename=tmp_path/'providers.json';filename.write_text(json.dumps(value));monkeypatch.setenv('FORMA_CONFIG_PATH',str(filename))

def test_no_implicit_accounts_or_environment_provider(tmp_path,monkeypatch):
    configure(tmp_path,monkeypatch,{})
    monkeypatch.setenv('FORMA_LLM_BASE_URL','https://should-not-be-used.invalid')
    assert discover_models()['models']=={}
    with pytest.raises(ValueError,match='выключен'):generate('codex','test','test',None,None)

def test_local_and_api_http_transport_and_key(tmp_path,monkeypatch):
    sample=json.loads((Path(__file__).resolve().parents[1]/'public/example-spec.json').read_text())
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            calls.append((self.path,self.headers.get('Authorization'),None))
            self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'data':[{'id':'transport-fixture'}]}).encode())
        def do_POST(self):
            value=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append((self.path,self.headers.get('Authorization'),value))
            self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(sample)}}]}).encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        config={name:{'enabled':True,'base_url':f'http://127.0.0.1:{server.server_port}/v1','model':'transport-fixture','api_key':'local-test-secret'} for name in ['api','local']}
        configure(tmp_path,monkeypatch,config)
        catalog=discover_models();assert set(catalog['models'])=={'api','local'}
        for provider in ['api','local']:
            assert catalog['models'][provider][0]['id']=='transport-fixture'
            result=generate(provider,'transport-fixture','Explicit HTTP transport fixture',None,None)
            assert result['name']==sample['name']
        assert all(auth=='Bearer local-test-secret' for _,auth,_ in calls)
        assert len([c for c in calls if c[0]=='/v1/chat/completions'])==2
        assert all(c[2]['model']=='transport-fixture' for c in calls if c[2])
    finally:server.shutdown();server.server_close();thread.join()

def test_configured_model_is_not_claimed_as_discovered(tmp_path,monkeypatch):
    configure(tmp_path,monkeypatch,{'local':{'enabled':True,'base_url':'http://127.0.0.1:1/v1','model':'explicit-name','api_key':''}})
    result=discover_models()
    assert result['models']['local'][0]['availability']=='configured'
    assert result['models']['local'][0]['source']=='local-config'
    assert result['errors']['local']
