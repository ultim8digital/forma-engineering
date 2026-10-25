"""Small-strain linear isotropic 3-D elasticity with constant-strain tetrahedra.

CAD -> Gmsh tetrahedra -> sparse elasticity -> stresses, reactions and mesh study.
No model-generated numbers or surrogate beam formula are used by this solver.
"""
import tempfile
import warnings
from pathlib import Path
import cadquery as cq
import gmsh
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve, MatrixRankWarning
from engineering_schema import Strength

def volume_mesh(shape, size):
    if shape.Volume()/size**3>12000:raise ValueError('Estimated mesh is too large; increase element size')
    with tempfile.TemporaryDirectory(prefix='forma-fem-') as folder:
        step=Path(folder)/'part.step'
        cq.exporters.export(shape,str(step))
        gmsh.initialize(['forma','-v','0'])
        try:
            gmsh.option.setNumber('General.Terminal',0)
            gmsh.option.setNumber('General.NumThreads',1)
            gmsh.option.setNumber('Mesh.RandomSeed',1)
            gmsh.model.occ.importShapes(str(step));gmsh.model.occ.synchronize()
            gmsh.option.setNumber('Mesh.MeshSizeMin',size)
            gmsh.option.setNumber('Mesh.MeshSizeMax',size)
            gmsh.option.setNumber('Mesh.ElementOrder',1)
            gmsh.option.setNumber('Mesh.Algorithm3D',1)
            gmsh.model.mesh.generate(3)
            tags,xyz,_=gmsh.model.mesh.getNodes()
            _,elements=gmsh.model.mesh.getElementsByType(4)
            tetra_tags=np.asarray(elements,dtype=np.int64).reshape(-1,4)
            if len(tetra_tags)<1:raise ValueError('Volume mesher returned no tetrahedra')
            if len(tetra_tags)>100000:raise ValueError('Mesh exceeds 100000 tetrahedra; increase mesh size')
            used=np.unique(tetra_tags)
            if len(used)>22000:raise ValueError('Mesh exceeds 22000 nodes; increase mesh size')
            lookup={int(tag):i for i,tag in enumerate(np.asarray(tags,dtype=np.int64))}
            points=np.asarray(xyz).reshape(-1,3)[[lookup[int(t)] for t in used]]
            tet=np.searchsorted(used,tetra_tags)
        finally:gmsh.finalize()
    return points,tet

def boundary_faces(tet):
    faces=np.concatenate([tet[:,[0,1,2]],tet[:,[0,1,3]],tet[:,[0,2,3]],tet[:,[1,2,3]]])
    unique,count=np.unique(np.sort(faces,axis=1),axis=0,return_counts=True)
    return unique[count==1]

def select_face(points,triangles,face):
    axis='xyz'.index(face.axis)
    bound=points[:,axis].min() if face.side=='min' else points[:,axis].max()
    tol=max(np.ptp(points[:,axis])*1e-7,1e-6)
    selected=triangles[np.all(np.abs(points[triangles,axis]-bound)<tol,axis=1)]
    if not len(selected):raise ValueError(f'No planar boundary at {face.axis}-{face.side}; choose another support/load face')
    return selected

def solve_mesh(points,tet,settings:Strength):
    n=len(points);m=len(tet)
    # N_i(x,y,z) = a_i + b_i*x + c_i*y + d_i*z.
    affine=np.concatenate([np.ones((m,4,1)),points[tet]],axis=2)
    determinants=np.linalg.det(affine);volumes=np.abs(determinants)/6
    if np.any(volumes<1e-12):raise ValueError('Degenerate tetrahedron in mesh')
    gradients=np.linalg.inv(affine)[:,1:,:].transpose(0,2,1)
    B=np.zeros((m,6,12))
    for i in range(4):
        x,y,z=gradients[:,i,:].T;d=3*i
        B[:,0,d]=x;B[:,1,d+1]=y;B[:,2,d+2]=z
        B[:,3,d]=y;B[:,3,d+1]=x
        B[:,4,d+1]=z;B[:,4,d+2]=y
        B[:,5,d]=z;B[:,5,d+2]=x
    E=settings.youngs_modulus_mpa;nu=settings.poisson_ratio
    lam=E*nu/((1+nu)*(1-2*nu));mu=E/(2*(1+nu))
    D=np.zeros((6,6));D[:3,:3]=lam;np.fill_diagonal(D[:3,:3],lam+2*mu);D[3:,3:]=np.eye(3)*mu
    element=np.einsum('eji,jk,ekl,e->eil',B,D,B,volumes,optimize=True)
    dofs=(tet[:,:,None]*3+np.arange(3)).reshape(m,12)
    rows=np.broadcast_to(dofs[:,:,None],(m,12,12)).ravel()
    cols=np.broadcast_to(dofs[:,None,:],(m,12,12)).ravel()
    K=coo_matrix((element.ravel(),(rows,cols)),shape=(3*n,3*n)).tocsr()
    surface=boundary_faces(tet);fixed_nodes=set()
    for face in settings.fixtures:fixed_nodes.update(select_face(points,surface,face).ravel().tolist())
    fixed=np.array(sorted(3*i+j for i in fixed_nodes for j in range(3)))
    if len(fixed)<9:raise ValueError('Insufficient clamp nodes')
    F=np.zeros((n,3));loaded_nodes=set()
    for load in settings.loads:
        tri=select_face(points,surface,load)
        area=np.linalg.norm(np.cross(points[tri[:,1]]-points[tri[:,0]],points[tri[:,2]]-points[tri[:,0]]),axis=1)/2
        if area.sum()<1e-10:raise ValueError('Load surface has zero area')
        for j in range(3):np.add.at(F,tri[:,j],area[:,None]*np.asarray(load.force_n)[None,:]/(3*area.sum()))
        loaded_nodes.update(tri.ravel().tolist())
    if fixed_nodes.intersection(loaded_nodes):raise ValueError('Load patch touches the clamped patch; separate the boundary regions')
    free=np.setdiff1d(np.arange(3*n),fixed);u=np.zeros(3*n)
    with warnings.catch_warnings():
        warnings.simplefilter('error',MatrixRankWarning)
        u[free]=spsolve(K[free,:][:,free],F.ravel()[free])
    if not np.all(np.isfinite(u)):raise ValueError('Singular system; check supports and connected solids')
    residual=K@u-F.ravel();relative_residual=np.linalg.norm(residual[free])/max(np.linalg.norm(F),1e-12)
    if relative_residual>1e-6:raise ValueError('Elastic solution failed equilibrium residual check')
    displacement=u.reshape(-1,3)
    strain=np.einsum('eij,ej->ei',B,u[dofs]);stress=strain@D.T
    sx,sy,sz,txy,tyz,tzx=stress.T
    vm=np.sqrt(0.5*((sx-sy)**2+(sy-sz)**2+(sz-sx)**2)+3*(txy**2+tyz**2+tzx**2))
    reaction=residual.reshape(-1,3)[sorted(fixed_nodes)].sum(axis=0)
    resultant=F.sum(axis=0);balance=np.linalg.norm(reaction+resultant)/max(sum(np.linalg.norm(x.force_n) for x in settings.loads),1e-12)
    if balance>1e-6:raise ValueError('Reaction force does not balance applied load')
    nodal_stress=np.zeros(n);weight=np.zeros(n)
    for j in range(4):np.add.at(nodal_stress,tet[:,j],vm*volumes);np.add.at(weight,tet[:,j],volumes)
    nodal_stress/=np.maximum(weight,1e-30)
    return {'points':points,'tetrahedra':tet,'surface':surface,'displacement':displacement,'stress':vm,'nodal_stress':nodal_stress,'max_displacement_mm':float(np.linalg.norm(displacement,axis=1).max()),'max_von_mises_mpa':float(vm.max()),'reaction_n':reaction.tolist(),'applied_n':resultant.tolist(),'relative_residual':float(relative_residual),'force_balance_error':float(balance),'loaded_mean_displacement_mm':displacement[sorted(loaded_nodes)].mean(axis=0).tolist(),'mesh_volume_mm3':float(volumes.sum()),'nodes':n,'elements':m}

def analyse_strength(parts,raw):
    settings=Strength.model_validate(raw)
    part=next((p for p in parts if p[0]==settings.component_id),None)
    if part is None:raise ValueError('Strength component not found')
    shape=part[4]
    if len(shape.Solids())!=1:raise ValueError('Static analysis requires a single connected solid')
    points,tet=volume_mesh(shape,settings.mesh_size_mm);coarse=solve_mesh(points,tet,settings)
    final=coarse;convergence=None
    if settings.refine:
        points,tet=volume_mesh(shape,settings.mesh_size_mm/1.5);final=solve_mesh(points,tet,settings)
        du=abs(final['max_displacement_mm']-coarse['max_displacement_mm'])/max(final['max_displacement_mm'],1e-15)
        ds=abs(final['max_von_mises_mpa']-coarse['max_von_mises_mpa'])/max(final['max_von_mises_mpa'],1e-15)
        convergence={'coarse_nodes':coarse['nodes'],'fine_nodes':final['nodes'],'displacement_change':du,'peak_stress_change':ds,'passed':du<=0.05 and ds<=0.15}
    scale=max(shape.BoundingBox().xlen,shape.BoundingBox().ylen,shape.BoundingBox().zlen)
    small=final['max_displacement_mm']/max(scale,1e-10)<=0.01
    safety=settings.yield_strength_mpa/max(final['max_von_mises_mpa'],1e-12)
    status='within_limits' if safety>=settings.target_safety_factor and small and convergence and convergence['passed'] else 'needs_review'
    notes=['Линейная статика отдельной детали, малые деформации, изотропный материал, элементы T4.','Контакты сборки, усталость, пластичность, потеря устойчивости и температура не рассчитаны.','Пиковое напряжение возле жёсткой заделки может быть сингулярным; проверь сходимость сетки.']
    printed=any(word in (part[2]+' '+part[3]).lower() for word in ['fdm','fff','печат','printing'])
    if settings.material_basis=='fdm_coupon_effective' or printed:
        notes.append('Для печатной детали изотропный расчёт условный. Межслойная прочность, ориентация слоёв, заполнение и анизотропия отдельно не решаются.');status='needs_review'
    if not small:notes.append('Перемещение превышает 1% габарита. Модель малых деформаций неприменима без дополнительной проверки.')
    if not settings.refine:notes.append('Уточнение сетки отключено; сходимость не подтверждена.')
    summary={k:v for k,v in final.items() if not isinstance(v,np.ndarray)}
    summary.update(status=status,solver='FORMA linear elasticity / Gmsh / SciPy',component_id=settings.component_id,inputs=settings.model_dump(),safety_factor=float(safety),target_safety_factor=settings.target_safety_factor,convergence=convergence,small_displacement_valid=small,warnings=notes)
    ids=np.unique(final['surface']);remap=np.full(len(final['points']),-1,dtype=int);remap[ids]=np.arange(len(ids))
    field={'vertices':final['points'][ids].tolist(),'triangles':remap[final['surface']].tolist(),'displacements':final['displacement'][ids].tolist(),'von_mises_mpa':final['nodal_stress'][ids].tolist(),'max_von_mises_mpa':final['max_von_mises_mpa'],'component_id':settings.component_id}
    return summary,field
