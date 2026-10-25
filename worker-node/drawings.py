"""Orthographic manufacturing drawings with explicit numerical tolerances.

Projection geometry is computed by OpenCascade HLR. Tolerances are supplied by
the owner; the program does not invent ISO fits, GD&T or process capability.
"""
import csv, hashlib, io, json, math, zipfile
from pathlib import Path
import cadquery as cq
import ezdxf
from OCP.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.BRepLib import BRepLib
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics import renderPDF
from reportlab.lib.utils import simpleSplit
from svglib.svglib import svg2rlg
import matplotlib
from engineering_schema import Manufacturing
from geometry import precise_box

MM=72/25.4
FONT='FormaSans'
if FONT not in pdfmetrics.getRegisteredFontNames():
    pdfmetrics.registerFont(TTFont(FONT,str(Path(matplotlib.get_data_path())/'fonts/ttf/DejaVuSans.ttf')))

def projected(shape,normal,xaxis):
    hlr=HLRBRep_Algo();hlr.Add(shape.wrapped)
    hlr.Projector(HLRAlgo_Projector(gp_Ax2(gp_Pnt(),gp_Dir(*normal),gp_Dir(*xaxis))))
    hlr.Update();hlr.Hide();result=HLRBRep_HLRToShape(hlr)
    visible=[];hidden=[]
    for target,methods in [(visible,['VCompound','Rg1LineVCompound','OutLineVCompound']),(hidden,['HCompound','OutLineHCompound'])]:
        for method in methods:
            raw=getattr(result,method)()
            if not raw.IsNull():BRepLib.BuildCurves3d_s(raw,1e-7);target.append(cq.Shape(raw))
    compound=cq.Compound.makeCompound(visible+hidden);bb=precise_box(compound)
    return visible,hidden,bb

def feature_rows(part,operations,settings):
    part_id,_,_,_,shape,_=part;bb=precise_box(shape);measured=[('bbox_x',bb.xlen,None),('bbox_y',bb.ylen,None),('bbox_z',bb.zlen,None)]
    warnings=[]
    for op in operations:
        if getattr(op,'type','')=='cylinder':
            present=False
            for face in shape.Faces():
                if face.geomType()=='CYLINDER':
                    cylinder=face._geomAdaptor().Cylinder()
                    center=cylinder.Location();direction=cylinder.Axis().Direction()
                    vector={'x':(1,0,0),'y':(0,1,0),'z':(0,0,1)}[op.axis]
                    cross=cq.Vector(center.X()-op.at[0],center.Y()-op.at[1],center.Z()-op.at[2]).cross(cq.Vector(*vector)).Length
                    dot=abs(direction.X()*vector[0]+direction.Y()*vector[1]+direction.Z()*vector[2])
                    if abs(cylinder.Radius()-op.radius)<1e-6 and cross<1e-5 and dot>0.999999:present=True;break
            if present:
                measured.append(('diameter',op.radius*2,op.id))
                for i,axis in enumerate('xyz'):
                    if axis!=op.axis:measured.append(('location_'+axis,op.at[i]-[bb.xmin,bb.ymin,bb.zmin][i],op.id))
            else:warnings.append(f'{part_id}/{op.id}: цилиндрическая поверхность после операций не найдена; диаметр не подтверждён.')
    rows=[];overrides={(d.feature,d.operation_id):d for d in settings.dimensions if d.component_id==part_id}
    for feature,actual,opid in measured:
        override=overrides.get((feature,opid));tol=settings.general_tolerance_mm
        nominal=override.nominal_mm if override else actual
        low=override.lower_deviation_mm if override else -tol if tol is not None else None
        high=override.upper_deviation_mm if override else tol
        rows.append({'feature':feature,'operation_id':opid,'nominal_mm':round(nominal,6),'actual_mm':round(actual,6),'lower_deviation_mm':low,'upper_deviation_mm':high,'passed':None if low is None else nominal+low-1e-6<=actual<=nominal+high+1e-6})
    for d in settings.dimensions:
        if d.component_id==part_id and not any(r['feature']==d.feature and r['operation_id']==d.operation_id for r in rows):
            warnings.append(f'{part_id}/{d.operation_id or d.feature}: заданный размер не найден в итоговой геометрии.')
    return rows,warnings

def value_text(row):
    prefix='Ø ' if row['feature']=='diameter' else ''
    value=f"{prefix}{row['nominal_mm']:.3f}".rstrip('0').rstrip('.')
    low,high=row['lower_deviation_mm'],row['upper_deviation_mm']
    if low is None:return value+' [допуск не задан]'
    if abs(low+high)<1e-10:return value+f' ± {high:g}'
    return value+f' ({high:+g} / {low:+g})'

def text(c,x,y,s,size=8):
    c.setFont(FONT,size);c.drawString(x*MM,y*MM,str(s))

def arrow(c,x,y,angle):
    size=1.3*MM;a=math.radians(angle);p=c.beginPath();p.moveTo(x,y)
    for d in (-0.35,0.35):p.lineTo(x+size*math.cos(a+d),y+size*math.sin(a+d))
    p.close();c.drawPath(p,fill=1,stroke=0)

def dimensions(c,x,y,w,h,horizontal,vertical):
    c.setStrokeColorRGB(.18,.22,.29);c.setFillColorRGB(.18,.22,.29);c.setLineWidth(.18*MM)
    # Coordinates are drawing-sheet mm. Extension lines start at actual bounds.
    c.line(x*MM,(y-1)*MM,x*MM,(y-9)*MM);c.line((x+w)*MM,(y-1)*MM,(x+w)*MM,(y-9)*MM)
    c.line(x*MM,(y-7)*MM,(x+w)*MM,(y-7)*MM);arrow(c,x*MM,(y-7)*MM,0);arrow(c,(x+w)*MM,(y-7)*MM,180)
    label=value_text(horizontal);c.setFont(FONT,7);c.drawCentredString((x+w/2)*MM,(y-5.5)*MM,label)
    c.line((x+w+1)*MM,y*MM,(x+w+10)*MM,y*MM);c.line((x+w+1)*MM,(y+h)*MM,(x+w+10)*MM,(y+h)*MM)
    c.line((x+w+7)*MM,y*MM,(x+w+7)*MM,(y+h)*MM);arrow(c,(x+w+7)*MM,y*MM,90);arrow(c,(x+w+7)*MM,(y+h)*MM,270)
    c.saveState();c.translate((x+w+9)*MM,(y+h/2)*MM);c.rotate(90);c.setFont(FONT,7);c.drawCentredString(0,0,value_text(vertical));c.restoreState()

def draw_view(c,projection,cell,scale,horizontal,vertical,title):
    visible,hidden,bb=projection;x,y,cw,ch=cell;w=bb.xlen*scale;h=bb.ylen*scale
    bx=x+(cw-w)/2;by=y+(ch-h)/2
    hp,vp=cq.exporters.svg.getPaths(visible,hidden)
    paths=''.join(f'<path d="{d}"/>' for d in vp)
    hidden_paths=''.join(f'<path d="{d}"/>' for d in hp)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w*MM}pt" height="{h*MM}pt" viewBox="0 0 {bb.xlen} {bb.ylen}"><g transform="translate({-bb.xmin},{bb.ymax}) scale(1,-1)" fill="none" stroke="#202a37" stroke-width="{.25/scale}">{paths}<g stroke="#7c8795" stroke-width="{.13/scale}" stroke-dasharray="{1/scale},{.7/scale}">{hidden_paths}</g></g></svg>'
    drawing=svg2rlg(io.BytesIO(svg.encode()));renderPDF.draw(drawing,c,bx*MM,by*MM)
    dimensions(c,bx,by,w,h,horizontal,vertical)
    text(c,x,y+ch+8,title+' · '+f'{scale:g}:1',7)

def draw_sheet(c,part,rows,views,settings,digest,page_label):
    width,height=landscape(A3);c.setPageSize((width,height));c.setStrokeColorRGB(.15,.2,.28);c.setFillColorRGB(.15,.2,.28);c.setLineWidth(.25*MM)
    c.rect(10*MM,10*MM,400*MM,277*MM)
    text(c,16,277,'neofab / WORKSHOP DRAWING',11);text(c,16,269,'Третья угловая проекция · размеры в мм · номинальная CAD-геометрия',7)
    maxx=max(v[2].xlen for v in views);maxy=max(v[2].ylen for v in views)
    fit=min(145/max(maxx,1e-8),64/max(maxy,1e-8));scales=[.02,.05,.1,.2,.25,.5,1,2,4,5,10,20]
    scale=max([s for s in scales if s<=fit] or [fit])
    byfeature={r['feature']:r for r in rows if r['feature']!='diameter'}
    draw_view(c,views[0],(20,110,175,80),scale,byfeature['bbox_x'],byfeature['bbox_z'],'СПЕРЕДИ / XZ')
    draw_view(c,views[1],(20,195,175,60),scale,byfeature['bbox_x'],byfeature['bbox_y'],'СВЕРХУ / XY')
    draw_view(c,views[2],(218,110,165,80),scale,byfeature['bbox_y'],byfeature['bbox_z'],'СПРАВА / YZ')
    text(c,218,258,'РАЗМЕРЫ И ДОПУСКИ',8)
    for index,row in enumerate(rows[:7]):
        y=247-index*7;label=(row['operation_id']+' · '+row['feature'].replace('location_','').upper()) if row['operation_id'] else {'bbox_x':'X - габарит','bbox_y':'Y - габарит','bbox_z':'Z - габарит'}.get(row['feature'],row['feature'])
        text(c,218,y,str(label)[:23],7);text(c,298,y,value_text(row),7)
    if len(rows)>7:text(c,218,193,'Полная таблица - на следующем листе.',7)
    part_id,name,material,process,_,_=part
    text(c,17,81,'ТЕХНИЧЕСКИЕ УКАЗАНИЯ',8)
    notes=[f'Материал: {material}. Способ изготовления: {process}.',f'Общий линейный допуск: ±{settings.general_tolerance_mm:g} мм.' if settings.general_tolerance_mm is not None else 'Общий допуск не задан. Чертёж неполный для изготовления.','Диаметры сверены с цилиндрическими поверхностями; координаты осей - от Xmin/Ymin/Zmin детали.','Неуказанные фаски, радиусы, посадки и технологические припуски не назначаются автоматически.','DXF содержит ортогональные проекции в масштабе 1:1. Это чертёж, не программа станка.']
    if settings.surface_roughness_ra_um:notes.append(f'Требуемая шероховатость Ra {settings.surface_roughness_ra_um:g} мкм. Возможность процесса не подтверждена.')
    y=75
    for note in notes:
        for line in simpleSplit(note,FONT,7,260*MM):text(c,17,y,line,7);y-=4
    if settings.notes:text(c,17,y-2,'Дополнительные технические указания приведены на отдельном листе.',7)
    c.rect(285*MM,10*MM,125*MM,34*MM);c.line(285*MM,22*MM,410*MM,22*MM)
    title_lines=simpleSplit(name,FONT,8,116*MM)
    for i,line in enumerate(title_lines[:2]):text(c,289,37-i*5,line,8)
    text(c,289,25,f'{part_id} · {digest}',7);text(c,289,15,'DRAFT / ТРЕБУЕТ ПРОВЕРКИ',7);text(c,372,15,page_label,7)
    c.showPage()
    if len(rows)>7:
        for start in range(0,len(rows),28):
            c.setPageSize((width,height));c.rect(10*MM,10*MM,400*MM,277*MM)
            text(c,18,274,f'{part_id} / ТАБЛИЦА РАЗМЕРОВ И ДОПУСКОВ',11)
            for index,row in enumerate(rows[start:start+28]):
                y=260-index*8
                text(c,18,y,str((row['operation_id']+' / ' if row['operation_id'] else '')+row['feature'])[:48],8);text(c,140,y,value_text(row),8);text(c,245,y,f"CAD: {row['actual_mm']:g} мм",8)
            text(c,18,17,'DRAFT. Размеры относятся к модели; достижимость допуска процессом не проверена.',7);c.showPage()
    if settings.notes:
        def notes_page():
            c.setPageSize((width,height));c.rect(10*MM,10*MM,400*MM,277*MM)
            text(c,18,274,f'{part_id} / ТЕХНИЧЕСКИЕ УКАЗАНИЯ',11)
            return 260
        y=notes_page()
        for index,note in enumerate(settings.notes):
            for line in simpleSplit(f'{index+1}. {note}',FONT,9,370*MM):
                if y<25:c.showPage();y=notes_page()
                text(c,18,y,line,9);y-=5
            y-=3
        text(c,18,17,'DRAFT / Требует инженерного согласования',7);c.showPage()

def create_drawings(parts,spec,out):
    settings=spec.engineering.manufacturing if spec.engineering else Manufacturing()
    digest=hashlib.sha256(spec.model_dump_json().encode()).hexdigest()[:10]
    complete=canvas.Canvas(str(out/'drawings.pdf'),pagesize=landscape(A3));complete.setTitle(spec.name+' - neofab drawings')
    records=[];warnings=[];csvdata=io.StringIO();writer=csv.writer(csvdata);writer.writerow(['part','feature','operation','nominal_mm','actual_mm','lower_deviation_mm','upper_deviation_mm','CAD_in_tolerance'])
    with zipfile.ZipFile(out/'drawings.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for index,part in enumerate(parts):
            operations=spec.operations if part[0]=='body' and spec.operations else next(c.operations for c in spec.components if c.id==part[0])
            rows,notes=feature_rows(part,operations,settings);warnings+=notes
            views=[projected(part[4],normal,xaxis) for normal,xaxis in [((0,-1,0),(1,0,0)),((0,0,1),(1,0,0)),((1,0,0),(0,1,0))]]
            folder=out/'parts'/part[0];folder.mkdir(parents=True,exist_ok=True)
            one=canvas.Canvas(str(folder/'drawing.pdf'),pagesize=landscape(A3));one.setTitle(part[1]);draw_sheet(one,part,rows,views,settings,digest,str(index+1));one.save();draw_sheet(complete,part,rows,views,settings,digest,str(index+1))
            doc=ezdxf.new('R2010');doc.units=4;msp=doc.modelspace();offset=0
            for view_index,(visible,hidden,bb) in enumerate(views):
                for kind,shapes in [('VISIBLE',visible),('HIDDEN',hidden)]:
                    layer=f'VIEW_{view_index+1}_{kind}';doc.layers.new(layer,dxfattribs={'color':7 if kind=='VISIBLE' else 8})
                    for group in shapes:
                        for edge in group.Edges():
                            vertices,_=edge.sample(0.01)
                            xy=[(v.x-bb.xmin+offset,v.y-bb.ymin) for v in vertices]
                            if len(xy)>=2:msp.add_lwpolyline(xy,close=edge.IsClosed(),dxfattribs={'layer':layer})
                msp.add_text(['FRONT XZ','TOP XY','RIGHT YZ'][view_index],dxfattribs={'height':2,'insert':(offset,-8)})
                offset+=bb.xlen+25
            msp.add_text('UNITS mm | NUMERIC TOLERANCES: see drawing.pdf | PROJECTION DXF, NOT CAM',dxfattribs={'height':2,'insert':(0,-16)})
            doc.saveas(folder/'drawing.dxf')
            for f in [folder/'drawing.pdf',folder/'drawing.dxf']:archive.write(f,f'{part[0]}/{f.name}')
            status='dimension_mismatch' if notes or any(r['passed'] is False for r in rows) else 'dimensioned_draft' if all(r['passed'] is True for r in rows) else 'missing_tolerances'
            records.append({'id':part[0],'name':part[1],'status':status,'dimensions':rows})
            for row in rows:writer.writerow([part[0],row['feature'],row['operation_id'],row['nominal_mm'],row['actual_mm'],row['lower_deviation_mm'],row['upper_deviation_mm'],row['passed']])
        complete.save();archive.write(out/'drawings.pdf','all-parts.pdf');archive.writestr('dimensions.csv',csvdata.getvalue())
    for d in settings.dimensions:
        if d.component_id not in [p[0] for p in parts]:warnings.append(f'Размер задан для отсутствующей детали {d.component_id}')
    return {'status':'dimensioned_draft' if not warnings and all(p['status']=='dimensioned_draft' for p in records) else 'needs_review','parts':records,'warnings':warnings+['Чертежи имеют статус DRAFT. GD&T, базирование, технологичность, доступ инструмента и фактическая точность изготовления требуют инженерного согласования.','Кривые DXF аппроксимированы с отклонением 0,01 мм; для точной геометрии используй STEP.']}
