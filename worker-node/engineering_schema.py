"""Versioned, explicit engineering inputs. All distances mm, forces N, stresses MPa."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Number = Annotated[float, Field(allow_inf_nan=False)]
Point = tuple[Number, Number, Number]

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Face(Strict):
    axis: Literal['x', 'y', 'z']
    side: Literal['min', 'max']

class Force(Face):
    force_n: Point

class Strength(Strict):
    component_id: str
    youngs_modulus_mpa: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    poisson_ratio: float = Field(gt=-0.9, le=0.45, allow_inf_nan=False)
    yield_strength_mpa: float = Field(gt=0, le=20000, allow_inf_nan=False)
    material_source: str = Field(min_length=4, max_length=500)
    material_basis: Literal['isotropic_bulk', 'fdm_coupon_effective']
    target_safety_factor: float = Field(ge=1, le=20, allow_inf_nan=False)
    mesh_size_mm: float = Field(ge=0.2, le=200, allow_inf_nan=False)
    refine: bool = True
    fixtures: list[Face] = Field(min_length=1, max_length=6)
    loads: list[Force] = Field(min_length=1, max_length=6)

    @model_validator(mode='after')
    def distinct_faces(self):
        fixed={(f.axis,f.side) for f in self.fixtures}
        if any((f.axis,f.side) in fixed for f in self.loads):
            raise ValueError('Load face cannot be the same as a clamped face')
        if not any(abs(v)>0 for f in self.loads for v in f.force_n):
            raise ValueError('At least one nonzero force is required')
        if sum(sum(v*v for v in f.force_n)**0.5 for f in self.loads)>1e8:
            raise ValueError('Force magnitude exceeds the supported limit')
        return self

class Driver(Strict):
    joint_name: str
    start: Number
    end: Number

class Motion(Strict):
    drivers: list[Driver] = Field(min_length=1, max_length=12)
    samples: int = Field(ge=2, le=61)
    clearance_mm: float = Field(ge=0, le=20, allow_inf_nan=False)

class Dimension(Strict):
    component_id: str
    feature: Literal['bbox_x', 'bbox_y', 'bbox_z', 'diameter', 'location_x', 'location_y', 'location_z']
    operation_id: str | None = None
    nominal_mm: float = Field(ge=0, le=4000, allow_inf_nan=False)
    lower_deviation_mm: float = Field(ge=-20, le=0, allow_inf_nan=False)
    upper_deviation_mm: float = Field(ge=0, le=20, allow_inf_nan=False)

class Manufacturing(Strict):
    general_tolerance_mm: float | None = Field(default=None, gt=0, le=10, allow_inf_nan=False)
    surface_roughness_ra_um: float | None = Field(default=None, gt=0, le=200, allow_inf_nan=False)
    dimensions: list[Dimension] = Field(default_factory=list, max_length=120)
    notes: list[str] = Field(default_factory=list, max_length=15)

    @model_validator(mode='after')
    def unique_dimensions(self):
        keys=[(d.component_id,d.feature,d.operation_id) for d in self.dimensions]
        if len(keys)!=len(set(keys)): raise ValueError('Duplicate tolerance definitions')
        return self

class Engineering(Strict):
    strength: Strength | None = None
    motion: Motion | None = None
    manufacturing: Manufacturing = Field(default_factory=Manufacturing)
