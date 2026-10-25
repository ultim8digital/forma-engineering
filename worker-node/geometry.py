"""Geometry measurements must not depend on cached display triangulation."""
import cadquery as cq
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

def precise_box(shape):
    box=Bnd_Box()
    BRepBndLib.AddOptimal_s(shape.wrapped,box,False,False)
    return cq.BoundBox(box)
