import io,json,sys,zipfile
from pathlib import Path
import cadquery as cq
import numpy as np
import pytest
from pypdf import PdfReader
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker-node'))
from cad import Spec,Joint,compile_part
from engineering_schema import Strength,Manufacturing
from strength import volume_mesh,solve_mesh
from motion import analyse_motion,pose_transforms
from drawings import create_drawings

def material(force,nu=0):
    return Strength(component_id='beam',youngs_modulus_mpa=210000,poisson_ratio=nu,yield_strength_mpa=250,material_source='Analytical verification example, not a material certificate',material_basis='isotropic_bulk',target_safety_factor=2,mesh_size_mm=3,refine=True,fixtures=[{'axis':'x','side':'min'}],loads=[{'axis':'x','side':'max','force_n':force}])

def test_axial_patch_and_equilibrium():
    shape=cq.Solid.makeBox(40,10,10);points,tet=volume_mesh(shape,4)
    result=solve_mesh(points,tet,material([100,0,0]))
    exact=100*40/(210000*100)
    assert result['loaded_mean_displacement_mm'][0]==pytest.approx(exact,rel=1e-6)
    assert result['max_von_mises_mpa']==pytest.approx(1,rel=1e-5)
    assert result['reaction_n'][0]==pytest.approx(-100,rel=1e-8)
    assert result['force_balance_error']<1e-8

def test_volume_meshing_is_reproducible():
    shape=cq.Solid.makeBox(12,8,6)
    p1,t1=volume_mesh(shape,2);p2,t2=volume_mesh(shape,2)
    assert np.array_equal(t1,t2)
    assert np.allclose(p1,p2,rtol=0,atol=1e-12)

def test_cantilever_converges_to_analytical_beam():
    shape=cq.Solid.makeBox(100,10,10);settings=material([0,0,-100],0.3)
    results=[]
    for size in [4,1.2]:
        points,tet=volume_mesh(shape,size);results.append(solve_mesh(points,tet,settings))
    exact=100*100**3/(3*210000*(10*10**3/12))
    errors=[abs(abs(r['loaded_mean_displacement_mm'][2])-exact)/exact for r in results]
    assert errors[1]<errors[0]
    assert errors[1]<0.08

def test_invalid_material_load_and_resource_limits():
    with pytest.raises(ValueError):material([0,0,0])
    with pytest.raises(ValueError):material([100,0,0],0.49)
    with pytest.raises(ValueError,match='too large'):volume_mesh(cq.Solid.makeBox(1000,1000,1000),0.2)

def motion_parts():
    block=cq.Solid.makeBox(2,2,2,cq.Vector(-1,-1,-1))
    slider=cq.Solid.makeBox(2,2,2,cq.Vector(-11,-1,-1))
    return [('block','Obstacle','test','test',block,block),('slider','Slider','test','test',slider,slider)]

def test_collision_between_clear_endpoints():
    joint=Joint(name='slide',type='prismatic',components=('block','slider'),description='test',axis=(1,0,0),origin=(0,0,0),limits=(0,20))
    result=analyse_motion(motion_parts(),[joint],{'drivers':[{'joint_name':'slide','start':0,'end':20}],'samples':21,'clearance_mm':0})
    assert result['status']=='collision'
    assert any(c['frame']==10 and c['penetration_mm3']>7.9 for c in result['collisions'])
    assert not any(c['frame'] in (0,20) for c in result['collisions'])
    assert len(result['frames'])==21

def test_joint_tree_transforms_and_closed_loop_rejected():
    joints=[Joint(name='r',type='revolute',components=('a','b'),description='',axis=(0,0,1),origin=(0,0,0),limits=(0,90)),Joint(name='f',type='fixed',components=('b','c'),description='')]
    from engineering_schema import Driver
    transforms,_=pose_transforms(['a','b','c'],joints,[Driver(joint_name='r',start=0,end=90)],1)
    assert transforms['c']@np.array([10,0,0,1])==pytest.approx([0,10,0,1],abs=1e-10)
    joints.append(Joint(name='loop',type='fixed',components=('c','a'),description=''))
    with pytest.raises(ValueError,match='loop'):pose_transforms(['a','b','c'],joints,[],0)

def test_four_bar_closed_loop_matches_parallelogram_geometry():
    from motion import constrained_pose
    from engineering_schema import Driver
    h=20*np.sin(np.pi/3)
    joints=[Joint(name='input',type='revolute',components=('ground','crank'),description='',axis=(0,0,1),origin=(0,0,0)),Joint(name='left',type='revolute',components=('crank','coupler'),description='',axis=(0,0,1),origin=(10,h,0)),Joint(name='right',type='revolute',components=('coupler','rocker'),description='',axis=(0,0,1),origin=(50,h,0)),Joint(name='base',type='revolute',components=('rocker','ground'),description='',axis=(0,0,1),origin=(40,0,0))]
    previous=None
    for t in np.linspace(0,1,11):
        matrices,_,previous,check=constrained_pose(['ground','crank','coupler','rocker'],joints,[Driver(joint_name='input',start=0,end=30)],float(t),previous)
        angle=np.pi/3+np.pi/6*t
        assert matrices['coupler']@np.array([10,h,0,1])==pytest.approx([20*np.cos(angle),20*np.sin(angle),0,1],abs=1e-6)
        assert check['constraint_residual_mm']<1e-7
        assert check['fully_constrained']
    joints[-1].limits=(-10,10)
    with pytest.raises(ValueError,match='limit'):constrained_pose(['ground','crank','coupler','rocker'],joints,[Driver(joint_name='input',start=0,end=30)],1,previous)

def test_dimensioned_drawings_and_numeric_tolerance_failure(tmp_path):
    raw=json.loads((Path(__file__).resolve().parents[1]/'public/example-spec.json').read_text())
    raw['engineering']={'manufacturing':{'general_tolerance_mm':0.2,'dimensions':[{'component_id':'axle','feature':'diameter','operation_id':'Ось','nominal_mm':8,'lower_deviation_mm':-0.01,'upper_deviation_mm':0.02}]}}
    report=compile_part(raw,tmp_path);drawings=report['engineering']['drawings']
    assert drawings['status']=='dimensioned_draft'
    assert len(drawings['parts'])==3
    fork=next(p for p in drawings['parts'] if p['id']=='fork')
    assert next(d for d in fork['dimensions'] if d['feature']=='bbox_z')['actual_mm']==36
    text=''.join(page.extract_text() for page in PdfReader(tmp_path/'drawings.pdf').pages)
    assert 'DRAFT' in text and '8 (+0.02 / -0.01)' in text
    with zipfile.ZipFile(tmp_path/'drawings.zip') as archive:
        assert all(f'{x}/drawing.dxf' in archive.namelist() for x in ('fork','roller','axle'))
    # Rebuilding an existing output folder must not retain stale duplicate drawings.
    compile_part(raw,tmp_path)
    with zipfile.ZipFile(tmp_path/'parts.zip') as archive:
        assert len(archive.namelist())==len(set(archive.namelist()))
    raw['engineering']['manufacturing']['dimensions'][0]['nominal_mm']=9
    report=compile_part(raw,tmp_path/'mismatch')
    assert report['engineering']['drawings']['status']=='needs_review'
    axle=next(p for p in report['engineering']['drawings']['parts'] if p['id']=='axle')
    assert any(row['passed'] is False for row in axle['dimensions'])
