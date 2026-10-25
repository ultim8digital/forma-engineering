import json, sys, zipfile
from pathlib import Path
import cadquery as cq
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker-node'))
from cad import Spec, compile_part
ROOT=Path(__file__).resolve().parents[1]
@pytest.fixture
def sample():return json.loads((ROOT/'public/example-spec.json').read_text())

def test_assembly_roundtrip_and_parts(sample,tmp_path):
    report=compile_part(sample,tmp_path)
    assert report['passed']
    assert report['solids']==3
    restored=cq.importers.importStep(str(tmp_path/'model.step'))
    assert len(restored.solids().vals())==3
    assert restored.val().isValid()
    mesh=json.loads((tmp_path/'mesh.json').read_text())
    assert len(mesh['groups'])==3
    for tri in mesh['triangles']:assert all(0<=i<len(mesh['vertices']) for i in tri)
    with zipfile.ZipFile(tmp_path/'parts.zip') as z:
        assert all(f'{i}/{i}.step' in z.namelist() for i in ('fork','roller','axle'))
        assert 'cad.py' in z.namelist() and 'source.py' in z.namelist()
    for name in ('fork','roller','axle'):
        part=cq.importers.importStep(str(tmp_path/'parts'/name/f'{name}.step'))
        assert len(part.solids().vals())==1

def test_interference_fails(sample,tmp_path):
    sample['components'][1]['at']=[0,0,0]
    report=compile_part(sample,tmp_path)
    assert not report['passed']
    assert any(not c['passed'] and 'Пересечение' in c['name'] for c in report['checks'])

def test_outside_cut_rejected(sample,tmp_path):
    sample['components'][0]['operations'][-1]['at']=[1000,1000,1000]
    with pytest.raises(ValueError,match='does not intersect'):compile_part(sample,tmp_path)

def test_incomplete_geometry_not_accepted(sample,tmp_path):
    sample['missing_geometry']=['Требуемая резьба M8 не построена']
    report=compile_part(sample,tmp_path)
    assert not report['passed']
    assert any(c['name']=='Незавершённые элементы' and not c['passed'] for c in report['checks'])

def test_envelope_requirement_is_checked(sample,tmp_path):
    sample['requirements']['bounds']=[90,44,36]
    report=compile_part(sample,tmp_path)
    assert not report['passed']
    assert any(c['name']=='Габариты по ТЗ' and not c['passed'] for c in report['checks'])

def test_code_and_path_injection_rejected(sample):
    sample['components'][0]['operations'][0]['type']='exec'
    with pytest.raises(ValueError):Spec.model_validate(sample)
    sample=json.loads((ROOT/'public/example-spec.json').read_text())
    sample['components'][0]['id']='../../escape'
    with pytest.raises(ValueError):Spec.model_validate(sample)

def test_nan_duplicate_and_invalid_joint_rejected(sample):
    sample['components'][0]['operations'][0]['size'][0]=float('nan')
    with pytest.raises(ValueError):Spec.model_validate(sample)
    sample=json.loads((ROOT/'public/example-spec.json').read_text());sample['components'][1]['id']='fork'
    with pytest.raises(ValueError):Spec.model_validate(sample)
    sample=json.loads((ROOT/'public/example-spec.json').read_text());sample['joints'][0]['components'][0]='unknown'
    with pytest.raises(ValueError):Spec.model_validate(sample)
