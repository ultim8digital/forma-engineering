import { z } from "zod";
const n = z.number().finite(),
  point = z.tuple([n, n, n]);
const face = z.object({
  axis: z.enum(["x", "y", "z"]),
  side: z.enum(["min", "max"]),
});
export const strengthSchema = z.object({
  component_id: z.string().min(1).max(40),
  youngs_modulus_mpa: n.gt(0).max(1000000),
  poisson_ratio: n.gt(-0.9).max(0.45),
  yield_strength_mpa: n.gt(0).max(20000),
  material_source: z.string().min(4).max(500),
  material_basis: z.enum(["isotropic_bulk", "fdm_coupon_effective"]),
  target_safety_factor: n.min(1).max(20),
  mesh_size_mm: n.min(0.2).max(200),
  refine: z.boolean(),
  fixtures: z.array(face).min(1).max(6),
  loads: z
    .array(face.extend({ force_n: point }))
    .min(1)
    .max(6),
});
export const motionSchema = z.object({
  drivers: z
    .array(
      z.object({ joint_name: z.string().min(1).max(120), start: n, end: n }),
    )
    .min(1)
    .max(12),
  samples: z.number().int().min(2).max(61),
  clearance_mm: n.min(0).max(20),
});
export const dimensionSchema = z.object({
  component_id: z.string().min(1).max(40),
  feature: z.enum([
    "bbox_x",
    "bbox_y",
    "bbox_z",
    "diameter",
    "location_x",
    "location_y",
    "location_z",
  ]),
  operation_id: z.string().max(80).nullable().default(null),
  nominal_mm: n.min(0).max(4000),
  lower_deviation_mm: n.min(-20).max(0),
  upper_deviation_mm: n.min(0).max(20),
});
export const manufacturingSchema = z.object({
  general_tolerance_mm: n.gt(0).max(10).nullable().default(null),
  surface_roughness_ra_um: n.gt(0).max(200).nullable().default(null),
  dimensions: z.array(dimensionSchema).max(120).default([]),
  notes: z.array(z.string().max(500)).max(15).default([]),
});
export const engineeringSchema = z.object({
  strength: strengthSchema.nullable().default(null),
  motion: motionSchema.nullable().default(null),
  manufacturing: manufacturingSchema.default({}),
});
export type Engineering = z.infer<typeof engineeringSchema>;
export const EMPTY_ENGINEERING: Engineering = {
  strength: null,
  motion: null,
  manufacturing: {
    general_tolerance_mm: null,
    surface_roughness_ra_um: null,
    dimensions: [],
    notes: [],
  },
};
export type MotionResult = {
  status: string;
  solver?: string;
  closure_checks?: {
    constraint_residual_mm: number;
    fully_constrained: boolean;
    rank: number;
    variables: number;
  }[];
  sample_count?: number;
  tested_pairs?: number;
  collisions?: {
    frame: number;
    t: number;
    components: string[];
    penetration_mm3: number;
    clearance_mm: number;
  }[];
  frames?: {
    t: number;
    transforms: Record<string, number[]>;
    joint_values: Record<string, number>;
  }[];
  steps?: { joint_name: string; step: number; unit: string }[];
  warnings?: string[];
  error?: string;
};
export type StrengthResult = {
  status: string;
  component_id?: string;
  max_displacement_mm?: number;
  max_von_mises_mpa?: number;
  safety_factor?: number;
  nodes?: number;
  elements?: number;
  relative_residual?: number;
  force_balance_error?: number;
  convergence?: {
    displacement_change: number;
    peak_stress_change: number;
    passed: boolean;
  } | null;
  warnings?: string[];
  error?: string;
};
export type DrawingResult = {
  status: string;
  parts?: {
    id: string;
    name: string;
    status: string;
    dimensions: {
      feature: string;
      nominal_mm: number;
      actual_mm: number;
      lower_deviation_mm: number | null;
      upper_deviation_mm: number | null;
      passed: boolean | null;
    }[];
  }[];
  warnings?: string[];
  error?: string;
};
export type EngineeringResults = {
  strength: StrengthResult;
  motion: MotionResult;
  drawings: DrawingResult;
};
export type ModelEntry = {
  id: string;
  label: string;
  description: string;
  source: string;
  availability: string;
  verified_at?: number;
};
export type ModelCatalog = {
  models: Record<string, ModelEntry[]>;
  errors: Record<string, string>;
  discovered_at: number;
};
export const modelCatalogSchema = z.object({
  models: z.record(
    z
      .array(
        z
          .object({
            id: z.string().max(160),
            label: z.string().max(250),
            description: z.string().max(1500),
            source: z.string().max(100),
            availability: z.string().max(30),
            verified_at: z.number().optional(),
          })
          .passthrough(),
      )
      .max(100),
  ),
  errors: z.record(z.string().max(500)),
  discovered_at: z.number(),
});
