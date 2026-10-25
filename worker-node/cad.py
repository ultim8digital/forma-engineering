"""Deterministic CAD compiler. Declarative input only; never exec model output."""
import csv, io, json, math, sys, zipfile
from pathlib import Path
from typing import Literal, Annotated, Union
import cadquery as cq
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from engineering_schema import Engineering
from geometry import precise_box

Finite = Annotated[float, Field(ge=-2000, le=2000, allow_inf_nan=False)]
Positive = Annotated[float, Field(gt=0, le=2000, allow_inf_nan=False)]
Point = tuple[Finite, Finite, Finite]
class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')
class Box(Strict):
    type: Literal['box']; id: str; mode: Literal['add','cut']; size: tuple[Positive,Positive,Positive]; at: Point
class Cylinder(Strict):
    type: Literal['cylinder']; id: str; mode: Literal['add','cut']; radius: Positive; height: Positive; axis: Literal['x','y','z']; at: Point
class Extrude(Strict):
    type: Literal['extrude']; id: str; mode: Literal['add','cut']; points: list[tuple[Finite,Finite]]=Field(min_length=3,max_length=100); plane: Literal['XY','XZ','YZ']; distance: Positive; at: Point
class Fillet(Strict):
    type: Literal['fillet']; id: str; radius: Positive; selector: Literal['|X','|Y','|Z','>Z','<Z','all']
class Chamfer(Strict):
    type: Literal['chamfer']; id: str; length: Positive; selector: Literal['|X','|Y','|Z','>Z','<Z','all']
Operation=Annotated[Union[Box,Cylinder,Extrude,Fillet,Chamfer],Field(discriminator='type')]
class Requirements(Strict):
    expected_solids: int=Field(ge=1,le=30); bounds: tuple[Positive,Positive,Positive]|None; tolerance: float=Field(gt=0,le=10,allow_inf_nan=False)
class Component(Strict):
    id: str=Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,39}$'); name: str=Field(max_length=120); material: str=Field(max_length=160); process: str=Field(max_length=160); operations: list[Operation]=Field(min_length=1,max_length=60); at: Point; rotation: Point; quantity: Literal[1]=1
class Joint(Strict):
    name: str; type: Literal['fixed','revolute','prismatic']; components: tuple[str,str]; description: str
    axis: Point | None = None
    origin: Point | None = None
    limits: tuple[Finite, Finite] | None = None
    home: Finite = 0

    @model_validator(mode='after')
    def valid_axis(self):
        if self.axis is not None and sum(x*x for x in self.axis)<1e-12:raise ValueError('Joint axis cannot be zero')
        if self.limits and self.limits[0]>self.limits[1]:raise ValueError('Joint limits must be increasing')
        if self.limits and not self.limits[0]<=self.home<=self.limits[1]:raise ValueError('Joint home must lie inside limits')
        return self
class Spec(Strict):
    schema_version: Literal['1.0']; name: str=Field(min_length=1,max_length=120); units: Literal['mm']; material: str=Field(max_length=160); process: str=Field(max_length=160); description: str=Field(max_length=4000); assumptions: list[str]=Field(max_length=30); missing_geometry: list[str]=Field(default_factory=list,max_length=30); operations: list[Operation]=Field(max_length=60); components: list[Component]=Field(default_factory=list,max_length=24); joints: list[Joint]=Field(default_factory=list,max_length=30); requirements: Requirements
    engineering: Engineering | None = None
    @model_validator(mode='after')
    def geometry(self):
        if not self.operations and not self.components: raise ValueError('No geometry supplied')
        ids=[c.id for c in self.components]
        if len(ids)!=len(set(ids)): raise ValueError('Component IDs must be unique')
        if len(self.operations)+sum(len(c.operations) for c in self.components)>300: raise ValueError('Max 300 total operations')
        for joint in self.joints:
            if any(c not in ids for c in joint.components): raise ValueError('Joint references unknown component')
        return self

def build(operations):
    result=None; log=[]
    for op in operations:
        before=result.Volume() if result else 0
        try:
            if isinstance(op,(Fillet,Chamfer)):
                if result is None: raise ValueError('No base solid')
                edges=cq.Workplane(obj=result).edges() if op.selector=='all' else cq.Workplane(obj=result).edges(op.selector)
                result=(edges.fillet(op.radius) if isinstance(op,Fillet) else edges.chamfer(op.length)).val()
            else:
                if isinstance(op,Box): tool=cq.Solid.makeBox(*op.size,cq.Vector(*op.at))
                elif isinstance(op,Cylinder): tool=cq.Solid.makeCylinder(op.radius,op.height,cq.Vector(*op.at),cq.Vector(*{'x':(1,0,0),'y':(0,1,0),'z':(0,0,1)}[op.axis]))
                else: tool=cq.Workplane(op.plane,origin=op.at).polyline(op.points).close().extrude(op.distance).val()
                if op.mode=='add': result=tool if result is None else result.fuse(tool).clean()
                else:
                    if result is None: raise ValueError('Cut requires a base solid')
                    if result.intersect(tool).Volume()<1e-7: raise ValueError('Cut does not intersect the part')
                    result=result.cut(tool).clean()
            if not result.isValid() or result.Volume()<1e-7: raise ValueError('Operation produced invalid or empty geometry')
            log.append({'id':op.id,'type':op.type,'volume_before':round(before,4),'volume_after':round(result.Volume(),4)})
        except Exception as e: raise ValueError(f'Operation {op.id}: {e}') from e
    return result,log

def compile_part(raw:dict,out:Path):
    spec=Spec.model_validate(raw);out.mkdir(parents=True,exist_ok=True)
    parts=[];logs=[];checks=[]
    if spec.operations:
        shape,log=build(spec.operations);parts.append(('body',spec.name,spec.material,spec.process,shape,shape));logs.append({'component':'body','operations':log})
    for c in spec.components:
        local,log=build(c.operations);world=local
        for degrees,axis in zip(c.rotation,[(1,0,0),(0,1,0),(0,0,1)]):
            if degrees:world=world.rotate((0,0,0),axis,degrees)
        world=world.translate(c.at);parts.append((c.id,c.name,c.material,c.process,local,world));logs.append({'component':c.id,'operations':log})
        checks.append({'name':f'{c.id}: одно корректное тело','passed':local.isValid() and len(local.Solids())==1,'detail':f'{len(local.Solids())} тел'})
    compound=cq.Compound.makeCompound([p[5] for p in parts]);bb=precise_box(compound);bounds=[bb.xlen,bb.ylen,bb.zlen]
    checks.extend([{'name':'Корректность B-Rep','passed':compound.isValid(),'detail':'Проверка OpenCascade'},{'name':'Количество тел','passed':len(compound.Solids())==spec.requirements.expected_solids,'detail':f'{len(compound.Solids())} / {spec.requirements.expected_solids}'},{'name':'Незавершённые элементы','passed':not spec.missing_geometry,'detail':'; '.join(spec.missing_geometry) or 'По декларации планировщика: недостающие элементы не заявлены'}])
    if spec.requirements.bounds:
        checks.append({'name':'Габариты по ТЗ','passed':all(abs(a-b)<=spec.requirements.tolerance for a,b in zip(bounds,spec.requirements.bounds)),'detail':f'{[round(x,3) for x in bounds]} мм; допуск проверки {spec.requirements.tolerance} мм'})
    for i,a in enumerate(parts):
        for b in parts[i+1:]:
            volume=a[5].intersect(b[5]).Volume()
            checks.append({'name':f'Пересечение {a[0]} / {b[0]}','passed':volume<1e-5,'detail':f'Общий объём {volume:.6f} мм³'})
    warnings=['Геометрическая проверка не является разрешением на изготовление.','Минимальная толщина стенки и доступ инструмента не проверены.','Усталость, GD&T и компенсация процесса требуют отдельной проверки.']
    warnings+=spec.assumptions
    report={'passed':all(c['passed'] for c in checks),'checks':checks,'warnings':warnings,'bounds_mm':[round(x,4) for x in bounds],'volume_mm3':round(compound.Volume(),4),'solids':len(compound.Solids()),'operations':logs,'verification_scope':'geometry_only'}
    assembly=cq.Assembly(name='FORMA')
    vertices=[];triangles=[];groups=[]
    with zipfile.ZipFile(out/'parts.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for part_id,name,material,process,local,world in parts:
            assembly.add(world,name=part_id)
            folder=out/'parts'/part_id;folder.mkdir(parents=True,exist_ok=True)
            cq.exporters.export(local,str(folder/f'{part_id}.step'));cq.exporters.export(local,str(folder/f'{part_id}.stl'),tolerance=0.05,angularTolerance=0.15)
            for filename in [f'{part_id}.step',f'{part_id}.stl']:
                archive.write(folder/filename,f'{part_id}/{filename}')
            vs,ts=world.tessellate(0.08,0.15);offset=len(vertices);start=len(triangles)
            vertices.extend([[v.x,v.y,v.z] for v in vs]);triangles.extend([[a+offset,b+offset,c+offset] for a,b,c in ts]);groups.append({'id':part_id,'name':name,'start':start,'count':len(ts),'center':list(world.Center().toTuple())})
        bom=io.StringIO();writer=csv.writer(bom);writer.writerow(['id','name','quantity','material','process']);writer.writerows([[p[0],p[1],1,p[2],p[3]] for p in parts]);(out/'bom.csv').write_text(bom.getvalue(),encoding='utf-8-sig');archive.writestr('bom.csv',bom.getvalue())
        archive.writestr('spec.json',spec.model_dump_json(indent=2))
    assembly.export(str(out/'model.step'))
    cq.exporters.export(compound,str(out/'model.stl'),tolerance=0.05,angularTolerance=0.15)
    (out/'mesh.json').write_text(json.dumps({'vertices':vertices,'triangles':triangles,'groups':groups,'bounds':bounds},separators=(',',':')))
    (out/'spec.json').write_text(spec.model_dump_json(indent=2))
    cq.exporters.export(compound,str(out/'drawing.svg'),opt={'width':1000,'height':750,'projectionDir':(1,-1,1),'showAxes':False,'showHidden':False})
    from drawings import create_drawings
    engineering={'strength':{'status':'not_configured'},'motion':{'status':'not_configured'}}
    field={'vertices':[],'triangles':[],'displacements':[],'von_mises_mpa':[]}
    if spec.engineering and spec.engineering.strength:
        from strength import analyse_strength
        try:engineering['strength'],field=analyse_strength(parts,spec.engineering.strength.model_dump())
        except Exception as e:engineering['strength']={'status':'failed','error':str(e)[:1200]}
    if spec.engineering and spec.engineering.motion:
        from motion import analyse_motion
        try:engineering['motion']=analyse_motion(parts,spec.joints,spec.engineering.motion.model_dump())
        except Exception as e:engineering['motion']={'status':'failed','error':str(e)[:1200]}
    engineering['drawings']=create_drawings(parts,spec,out)
    report['engineering']={key:{k:v for k,v in result.items() if k!='frames'} for key,result in engineering.items()}
    report['verification_scope']='geometry_and_explicit_engineering_checks'
    report['manufacturing_release']='draft_requires_engineer_review'
    (out/'engineering.json').write_text(json.dumps(engineering,ensure_ascii=False,indent=2))
    (out/'strength-mesh.json').write_text(json.dumps(field,separators=(',',':')))
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (out/'source.py').write_text('# Rebuild with the FORMA compiler (cad.py) and CadQuery 2.8.0.\n# This source never executes generated Python.\nimport json\nfrom pathlib import Path\nfrom cad import compile_part\nSPEC = json.loads('+repr(spec.model_dump_json())+')\ncompile_part(SPEC, Path("rebuilt"))\n')
    # Include the exact compiler so downloaded source is independently rebuildable.
    with zipfile.ZipFile(out/'parts.zip','a',zipfile.ZIP_DEFLATED) as archive:
        for module in ['cad.py','geometry.py','engineering_schema.py','strength.py','motion.py','drawings.py']:
            archive.write(Path(__file__).with_name(module),module)
        for name in ['source.py','drawing.svg','drawings.pdf','drawings.zip','report.json','engineering.json','strength-mesh.json']:
            archive.write(out/name,name)
        for part in parts:
            for name in ['drawing.pdf','drawing.dxf']:
                archive.write(out/'parts'/part[0]/name,f'{part[0]}/{name}')
        archive.writestr('requirements.txt',Path(__file__).with_name('requirements.txt').read_text())
    return report
if __name__=='__main__':
    report=compile_part(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]));print(json.dumps(report,ensure_ascii=False))
