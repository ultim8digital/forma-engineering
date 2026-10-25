import { z } from "zod";
const num = z.number().finite().min(-2000).max(2000),
  positive = z.number().finite().gt(0).max(2000),
  point = z.tuple([num, num, num]);
export const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("box"),
    id: z.string().max(80),
    mode: z.enum(["add", "cut"]),
    size: z.tuple([positive, positive, positive]),
    at: point,
  }),
  z.object({
    type: z.literal("cylinder"),
    id: z.string().max(80),
    mode: z.enum(["add", "cut"]),
    radius: positive,
    height: positive,
    axis: z.enum(["x", "y", "z"]),
    at: point,
  }),
  z.object({
    type: z.literal("extrude"),
    id: z.string().max(80),
    mode: z.enum(["add", "cut"]),
    points: z
      .array(z.tuple([num, num]))
      .min(3)
      .max(100),
    plane: z.enum(["XY", "XZ", "YZ"]),
    distance: positive,
    at: point,
  }),
  z.object({
    type: z.literal("fillet"),
    id: z.string().max(80),
    radius: positive,
    selector: z.enum(["|X", "|Y", "|Z", ">Z", "<Z", "all"]),
  }),
  z.object({
    type: z.literal("chamfer"),
    id: z.string().max(80),
    length: positive,
    selector: z.enum(["|X", "|Y", "|Z", ">Z", "<Z", "all"]),
  }),
]);
const partFields = {
  name: z.string().min(1).max(120),
  material: z.string().max(160),
  process: z.string().max(160),
  operations: z.array(operationSchema).max(60),
};
export const specSchema = z
  .object({
    schema_version: z.literal("1.0"),
    ...partFields,
    units: z.literal("mm"),
    description: z.string().max(4000),
    assumptions: z.array(z.string().max(500)).max(30),
    missing_geometry: z.array(z.string().max(500)).max(30).default([]),
    components: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/),
          ...partFields,
          operations: z.array(operationSchema).min(1).max(60),
          at: point,
          rotation: point,
          quantity: z.number().int().min(1).max(1),
        }),
      )
      .max(24)
      .default([]),
    joints: z
      .array(
        z.object({
          name: z.string().max(120),
          type: z.enum(["fixed", "revolute", "prismatic"]),
          components: z.tuple([z.string(), z.string()]),
          description: z.string().max(500),
        }),
      )
      .max(30)
      .default([]),
    requirements: z.object({
      expected_solids: z.number().int().min(1).max(30),
      bounds: z.tuple([positive, positive, positive]).nullable(),
      tolerance: z.number().finite().gt(0).max(10),
    }),
  })
  .refine(
    (v) => v.operations.length > 0 || v.components.length > 0,
    "Нужна геометрия детали или компоненты сборки.",
  );
export type PartSpec = z.infer<typeof specSchema>;
export const SAMPLE: PartSpec = {
  schema_version: "1.0",
  name: "Роликовая опора / R24",
  units: "mm",
  material: "По компонентам",
  process: "Сборка",
  description:
    "Три отдельных компонента: вилка, ролик и ось. Ролик с радиальным зазором 0,3 мм и осевым зазором 1 мм с каждой стороны.",
  assumptions: [
    "Учебная сборка, созданная вручную. Нагрузки и ресурс не заданы.",
    "Ось без стопоров: способ её фиксации требует проектирования.",
    "Зазоры номинальные; компенсация конкретного принтера не учтена.",
  ],
  missing_geometry: [],
  operations: [],
  components: [
    {
      id: "fork",
      name: "01 · Вилка",
      material: "PETG",
      process: "FDM-печать",
      quantity: 1,
      at: [0, 0, 0],
      rotation: [0, 0, 0],
      operations: [
        {
          type: "box",
          id: "Площадка",
          mode: "add",
          size: [64, 44, 6],
          at: [-32, -22, 0],
        },
        {
          type: "box",
          id: "Левая щека",
          mode: "add",
          size: [6, 32, 30],
          at: [-22, -16, 6],
        },
        {
          type: "box",
          id: "Правая щека",
          mode: "add",
          size: [6, 32, 30],
          at: [16, -16, 6],
        },
        {
          type: "cylinder",
          id: "Посадка оси",
          mode: "cut",
          radius: 4.3,
          height: 46,
          axis: "x",
          at: [-23, 0, 24],
        },
        {
          type: "cylinder",
          id: "Крепление 1",
          mode: "cut",
          radius: 2.7,
          height: 8,
          axis: "z",
          at: [-25, -15, -1],
        },
        {
          type: "cylinder",
          id: "Крепление 2",
          mode: "cut",
          radius: 2.7,
          height: 8,
          axis: "z",
          at: [25, 15, -1],
        },
      ],
    },
    {
      id: "roller",
      name: "02 · Ролик",
      material: "POM / PETG",
      process: "Точение / FDM-печать",
      quantity: 1,
      at: [0, 0, 24],
      rotation: [0, 0, 0],
      operations: [
        {
          type: "cylinder",
          id: "Тело ролика",
          mode: "add",
          radius: 12,
          height: 30,
          axis: "x",
          at: [-15, 0, 0],
        },
        {
          type: "cylinder",
          id: "Отверстие",
          mode: "cut",
          radius: 4.3,
          height: 32,
          axis: "x",
          at: [-16, 0, 0],
        },
      ],
    },
    {
      id: "axle",
      name: "03 · Ось Ø8",
      material: "Сталь",
      process: "Точение",
      quantity: 1,
      at: [0, 0, 24],
      rotation: [0, 0, 0],
      operations: [
        {
          type: "cylinder",
          id: "Ось",
          mode: "add",
          radius: 4,
          height: 50,
          axis: "x",
          at: [-25, 0, 0],
        },
      ],
    },
  ],
  joints: [
    {
      name: "Вращение ролика",
      type: "revolute",
      components: ["roller", "axle"],
      description:
        "Номинальный радиальный зазор 0,3 мм. Кинематика не рассчитана.",
    },
  ],
  requirements: { expected_solids: 3, bounds: [64, 44, 36], tolerance: 0.01 },
};
