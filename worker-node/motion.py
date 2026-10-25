"""Prescribed joint-tree motion and exact CAD interference at sampled poses."""
import math
import cadquery as cq
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.gp import gp_Trsf
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from engineering_schema import Motion

def joint_matrix(kind,axis,origin,value):
    axis=np.asarray(axis,dtype=float);axis=axis/np.linalg.norm(axis);origin=np.asarray(origin,dtype=float)
    matrix=np.eye(4)
    if kind=='prismatic':matrix[:3,3]=axis*value
    elif kind=='revolute':
        x,y,z=axis;K=np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
        angle=math.radians(value);R=np.eye(3)+math.sin(angle)*K+(1-math.cos(angle))*(K@K)
        matrix[:3,:3]=R;matrix[:3,3]=origin-R@origin
    return matrix

def rigid_transform(shape,matrix):
    transform=gp_Trsf();transform.SetValues(*[float(v) for v in matrix[:3,:].flatten()])
    return cq.Shape.cast(BRepBuilderAPI_Transform(shape.wrapped,transform,True).Shape())

def pose_transforms(component_ids,joints,drivers,t):
    incoming={};names=set();by_name={}
    for joint in joints:
        name=joint.name
        if name in names:raise ValueError('Joint names must be unique')
        names.add(name);by_name[name]=joint
        parent,child=joint.components
        if parent not in component_ids or child not in component_ids:raise ValueError('Unknown joint component')
        if parent==child or child in incoming:raise ValueError('Closed loops or multiple-parent link constraints require a loop-closure solver; not supported')
        incoming[child]=joint
    driver_names=[d.joint_name for d in drivers]
    if len(driver_names)!=len(set(driver_names)):raise ValueError('Duplicate driver for a joint')
    values={}
    for driver in drivers:
        joint=by_name.get(driver.joint_name)
        if joint is None or joint.type=='fixed':raise ValueError('Driver must reference a revolute or prismatic joint')
        if joint.axis is None or joint.origin is None:raise ValueError('Moving joint requires an axis and origin in the assembly rest frame')
        value=driver.start+(driver.end-driver.start)*t
        if joint.limits and not (joint.limits[0]-1e-9<=value<=joint.limits[1]+1e-9):raise ValueError('Driver exceeds joint limits')
        values[joint.name]=value
    transforms={};visiting=set()
    def transform(component):
        if component in transforms:return transforms[component]
        if component in visiting:raise ValueError('Closed kinematic loop is not supported by the joint-tree solver')
        visiting.add(component)
        if component not in incoming:result=np.eye(4)
        else:
            joint=incoming[component];parent=transform(joint.components[0]);relative=np.eye(4)
            if joint.type!='fixed':
                if joint.name in values:relative=joint_matrix(joint.type,joint.axis,joint.origin,values[joint.name]-joint.home)
            result=parent@relative
        visiting.remove(component);transforms[component]=result;return result
    for component in component_ids:transform(component)
    return transforms,values

def box_distance(a,b):
    A=a.BoundingBox();B=b.BoundingBox()
    return math.sqrt(sum(max(0,lo2-hi1,lo1-hi2)**2 for lo1,hi1,lo2,hi2 in [(A.xmin,A.xmax,B.xmin,B.xmax),(A.ymin,A.ymax,B.ymin,B.ymax),(A.zmin,A.zmax,B.zmin,B.zmax)]))

def constrained_pose(component_ids,joints,drivers,t,previous=None):
    """Rigid-body joint closure, including closed loops. First component is ground."""
    ground=component_ids[0];moving=component_ids[1:];index={name:i for i,name in enumerate(moving)}
    names=[j.name for j in joints]
    if len(names)!=len(set(names)):raise ValueError('Joint names must be unique')
    values={d.joint_name:d.start+(d.end-d.start)*t for d in drivers}
    for d in drivers:
        j=next((j for j in joints if j.name==d.joint_name),None)
        if j is None or j.type=='fixed':raise ValueError('Invalid joint driver')
        if j.limits and not j.limits[0]-1e-9<=values[j.name]<=j.limits[1]+1e-9:raise ValueError('Driver exceeds joint limits')
    for joint in joints:
        if joint.type!='fixed' and (joint.axis is None or joint.origin is None):raise ValueError('All moving loop joints require explicit axis and origin')
        if any(c not in component_ids for c in joint.components):raise ValueError('Unknown joint component')
    length_scale=max([np.linalg.norm(j.origin) for j in joints if j.origin]+[1])
    def matrices(x):
        result={ground:np.eye(4)}
        for name,i in index.items():
            matrix=np.eye(4);matrix[:3,:3]=Rotation.from_rotvec(x[i*6:i*6+3]).as_matrix();matrix[:3,3]=x[i*6+3:i*6+6];result[name]=matrix
        return result
    def residual(x):
        transforms=matrices(x);errors=[]
        for joint in joints:
            A,B=[transforms[c] for c in joint.components];RA,RB=A[:3,:3],B[:3,:3]
            p=np.asarray(joint.origin or (0,0,0));delta=(B[:3,:3]@p+B[:3,3])-(A[:3,:3]@p+A[:3,3])
            value=values.get(joint.name,joint.home)-joint.home
            if joint.type=='fixed':errors.extend(delta);errors.extend(Rotation.from_matrix(RA.T@RB).as_rotvec()*length_scale)
            else:
                axis=np.asarray(joint.axis,dtype=float);axis/=np.linalg.norm(axis);world_axis=RA@axis
                if joint.type=='revolute':
                    errors.extend(delta)
                    if joint.name in values:
                        desired=RA@Rotation.from_rotvec(axis*math.radians(value)).as_matrix();errors.extend(Rotation.from_matrix(desired.T@RB).as_rotvec()*length_scale)
                    else:
                        other=RB@axis;errors.extend(np.cross(world_axis,other)*length_scale);errors.append((1-np.dot(world_axis,other))*length_scale)
                else:
                    errors.extend(delta-world_axis*np.dot(delta,world_axis));errors.extend(Rotation.from_matrix(RA.T@RB).as_rotvec()*length_scale)
                    if joint.name in values:errors.append(np.dot(delta,world_axis)-value)
        return np.asarray(errors)
    initial=np.zeros(len(moving)*6) if previous is None else previous
    result=least_squares(residual,initial,xtol=1e-11,ftol=1e-11,gtol=1e-11,max_nfev=300)
    error=float(np.max(np.abs(result.fun))) if len(result.fun) else float('inf')
    if not result.success or error>1e-5:raise ValueError(f'Joint closure failed at t={t:g}; maximum scaled constraint residual {error:.6g} mm')
    rank=int(np.linalg.matrix_rank(result.jac,tol=1e-7))
    solved=matrices(result.x)
    for joint in joints:
        if joint.type=='fixed':continue
        A,B=[solved[c] for c in joint.components]
        axis=np.asarray(joint.axis,dtype=float);axis/=np.linalg.norm(axis)
        if joint.name not in values:
            if joint.type=='revolute':q=joint.home+math.degrees(float(np.dot(Rotation.from_matrix(A[:3,:3].T@B[:3,:3]).as_rotvec(),axis)))
            else:
                p=np.asarray(joint.origin);delta=(B[:3,:3]@p+B[:3,3])-(A[:3,:3]@p+A[:3,3]);q=joint.home+float(np.dot(delta,A[:3,:3]@axis))
            values[joint.name]=q
        if joint.limits and not joint.limits[0]-1e-6<=values[joint.name]<=joint.limits[1]+1e-6:raise ValueError(f'Joint limit exceeded for {joint.name}: {values[joint.name]:.6g}')
    return solved,values,result.x,{'constraint_residual_mm':error,'rank':rank,'variables':len(initial),'fully_constrained':rank==len(initial)}

def analyse_motion(parts,joints,raw):
    settings=Motion.model_validate(raw)
    if len(parts)*(len(parts)-1)//2*settings.samples>8000:raise ValueError('Motion check exceeds 8000 pose/pair tests; reduce sample count or component count')
    ids=[p[0] for p in parts];collisions=[];frames=[];minimum=None;tested=0;previous=None;closures=[]
    # A tree uses exact forward kinematics. Loops use a numerical joint solver.
    try:pose_transforms(ids,joints,settings.drivers,0);closed_loop=False
    except ValueError as e:
        if 'loop' not in str(e) and 'multiple-parent' not in str(e):raise
        closed_loop=True
    for index in range(settings.samples):
        t=index/(settings.samples-1)
        if closed_loop:
            transforms,values,previous,closure=constrained_pose(ids,joints,settings.drivers,t,previous);closures.append(closure)
        else:transforms,values=pose_transforms(ids,joints,settings.drivers,t)
        placed=[(p[0],rigid_transform(p[5],transforms[p[0]])) for p in parts]
        frames.append({'t':round(t,6),'transforms':{k:v.flatten().tolist() for k,v in transforms.items()},'joint_values':values})
        for i,(aid,a) in enumerate(placed):
            for bid,b in placed[i+1:]:
                tested+=1
                lower=box_distance(a,b)
                if lower>settings.clearance_mm+1e-7:continue
                volume=a.intersect(b).Volume()
                distance=0.0 if volume>1e-6 else BRepExtrema_DistShapeShape(a.wrapped,b.wrapped).Value()
                minimum=distance if minimum is None else min(minimum,distance)
                if volume>1e-6 or distance+1e-7<settings.clearance_mm:
                    if len(collisions)<1000:collisions.append({'frame':index,'t':round(t,6),'components':[aid,bid],'penetration_mm3':round(volume,6),'clearance_mm':round(distance,6)})
    steps=[{'joint_name':d.joint_name,'step':abs(d.end-d.start)/(settings.samples-1),'unit':'deg' if next(j for j in joints if j.name==d.joint_name).type=='revolute' else 'mm'} for d in settings.drivers]
    return {'status':'collision' if collisions else 'underconstrained' if any(not c['fully_constrained'] for c in closures) else 'sampled_clear','solver':('Numerical rigid-body joint closure' if closed_loop else 'Exact joint-tree kinematics')+' / OpenCascade B-Rep','closure_checks':closures,'inputs':settings.model_dump(),'sample_count':settings.samples,'tested_pairs':tested,'collisions':collisions,'minimum_checked_clearance_mm':minimum,'steps':steps,'frames':frames,'warnings':['Проверены дискретные положения. Отсутствие столкновений между ними не доказано.','Замкнутые связи решаются численно с контролем невязки. Динамика, трение, инерция и зубчатые зацепления не рассчитываются.','Незаданные связи сохраняют исходное положение; все пары компонентов участвуют в проверке. Первая деталь в замкнутой сборке считается неподвижной.']}
