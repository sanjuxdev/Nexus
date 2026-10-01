import { z } from 'zod';

export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const OriginSchema = z.string().refine((val) => {
  return /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(val);
}, { message: 'Origin must be scheme+host+port only, no paths or trailing slashes' });

export const FrameIdSchema = z.string();

export const SourceSchema = z.enum(['DOM', 'ARIA', 'VISION', 'OCR']);

export const SemanticTypeSchema = z.enum([
  'button', 'input', 'checkbox', 'dropdown', 'link', 'tab', 'menu', 'dialog',
  'chart', 'table', 'card', 'navigation', 'image', 'text', 'custom_control', 'unknown',
]);

export const VisualStateSchema = z.enum([
  'enabled', 'disabled', 'selected', 'expanded', 'collapsed',
  'focused', 'checked', 'unchecked', 'visible',
]);

export const StageNameSchema = z.enum([
  'capture', 'dom', 'route', 'vision', 'ocr', 'face', 'ground', 'fuse',
  'pii', 'redact', 'firewall', 'network', 'server', 'validate', 'execute', 'settle',
]);

export const StageErrorCodeSchema = z.enum([
  'VISION_UNAVAILABLE', 'PRIVACY_BLOCK', 'PRIVACY_ERROR', 'SERVER_UNAVAILABLE',
  'SERVER_INVALID', 'STALE_STATE', 'ORIGIN_MISMATCH', 'FRAME_MISMATCH',
  'POLICY_DENIED', 'TARGET_NOT_FOUND', 'NOT_INTERACTABLE',
  'CAPABILITY_DENIED', 'TEXT_UNSAFE', 'TIMEOUT', 'INTERNAL',
]);

export const StageErrorSchema = z.object({
  code: StageErrorCodeSchema,
  stage: StageNameSchema,
  message: z.string(),
  retryable: z.boolean(),
  detail: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict();

export const TelemetryEventSchema = z.object({
  ts: z.number(),
  cycle_id: z.string(),
  stage: StageNameSchema,
  duration_ms: z.number(),
  meta: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict();

export const FrameInfoSchema = z.object({
  frame_id: FrameIdSchema,
  parent_frame_id: FrameIdSchema.nullable(),
  origin: z.string(),
  path: z.string(),
  offset: z.tuple([z.number(), z.number()]),
  accessible: z.boolean(),
}).strict();

export const DomElementInfoSchema = z.object({
  dom_id: z.string(),
  frame_id: FrameIdSchema,
  origin: z.string(),
  tag: z.string(),
  role: z.string().nullable(),
  name: z.string().nullable(),
  text: z.string(),
  aria: z.object({
    expanded: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    disabled: z.boolean().optional(),
    selected: z.boolean().optional(),
    pressed: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }).strict(),
  input: z.object({
    type: z.string(),
    autocomplete: z.string().nullable(),
    name: z.string().nullable(),
    placeholder: z.string().nullable(),
    is_password: z.boolean(),
    has_value: z.boolean(),
    value: z.string().nullable(),
  }).strict().optional(),
  bbox: BBoxSchema,
  visible: z.boolean(),
  in_viewport: z.boolean(),
  occluded: z.boolean(),
  interactable: z.boolean(),
  rendering: z.enum([
    'html', 'canvas', 'svg', 'img', 'video', 'iframe',
    'shadow_open', 'shadow_closed', 'custom',
  ]),
  has_bg_image: z.boolean(),
  handlers_hint: z.boolean(),
  parent_dom_id: z.string().nullable(),
  classes: z.array(z.string()).optional(),
  attributes: z.record(z.string()).optional(),
  element_id: z.string().nullable().optional(),
  element_name: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  aria_label: z.string().nullable().optional(),
  aria_labelledby: z.string().nullable().optional(),
  aria_describedby: z.string().nullable().optional(),
  form_id: z.string().nullable().optional(),
  stable_selector: z.string().nullable().optional(),
}).strict();

export const DomSnapshotSchema = z.object({
  snapshot_id: z.string(),
  url_origin: z.string(),
  url_path: z.string(),
  frames: z.array(FrameInfoSchema),
  elements: z.array(DomElementInfoSchema),
  viewport: z.object({ w: z.number(), h: z.number() }).strict(),
  dpr: z.number(),
  scroll: z.object({ x: z.number(), y: z.number() }).strict(),
  page_state_hash: z.string(),
  ts: z.number(),
}).strict();

export const RoutingLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const VisionTaskSchema = z.enum(['ocr', 'ui_detect', 'face', 'ground']);
export const BudgetLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const BudgetSchema = z.object({
  level: BudgetLevelSchema,
  backend: z.enum(['webgpu', 'webgl', 'wasm', 'none']),
  max_vision_regions: z.number(),
  max_pixels: z.number(),
  allow_detector: z.boolean(),
  ocr_mode: z.enum(['off', 'fast', 'high_recall']),
}).strict();

export const RoutingDecisionSchema = z.object({
  region_key: z.string(),
  dom_id: z.string().nullable(),
  level: RoutingLevelSchema,
  reasons: z.array(z.string()),
  crop: BBoxSchema.nullable(),
  needs: z.array(VisionTaskSchema),
}).strict();

export const RoutingPlanSchema = z.object({
  snapshot_id: z.string(),
  page_state_hash: z.string(),
  decisions: z.array(RoutingDecisionSchema),
  needs_screenshot: z.boolean(),
  budget: BudgetSchema,
}).strict();

export const CaptureMetaSchema = z.object({
  capture_id: z.string(),
  page_state_hash: z.string(),
  dpr: z.number(),
  viewport: z.object({ w: z.number(), h: z.number() }).strict(),
  scroll: z.object({ x: z.number(), y: z.number() }).strict(),
  image: z.object({ w: z.number(), h: z.number() }).strict(),
  ts: z.number(),
}).strict();

export const OcrTokenSchema = z.object({
  text: z.string(),
  bbox: BBoxSchema,
  confidence: z.number(),
  line_id: z.number(),
}).strict();

export const FaceBoxSchema = z.object({
  bbox: BBoxSchema,
  confidence: z.number(),
  coordinateSpace: z.literal('frame'),
}).strict();

export const PiiTypeSchema = z.enum([
  'EMAIL', 'PHONE', 'PERSON', 'ADDRESS', 'DOB', 'CARD', 'PASSWORD',
  'AUTH_TOKEN', 'GOV_ID', 'BANK_ACCOUNT', 'FACE', 'IDENTIFIER',
]);

export const CapabilityDescriptorSchema = z.object({
  ref: z.string(),
  kind: z.enum(['password', 'email', 'phone', 'token', 'profile']),
  label: z.string(),
}).strict();

export const ActionTypeSchema = z.enum([
  'click', 'scroll', 'focus', 'select', 'type', 'keypress', 'fill_secret', 'navigate', 'back'
]);

export const StepSummarySchema = z.object({
  step: z.number(),
  action: ActionTypeSchema,
  target_region_id: z.string().nullable(),
  result: z.enum(['ok', 'blocked', 'failed']),
  note: z.string().nullable(),
}).strict();

export const ActionParamsSchema = z.object({
  text: z.string().optional(),
  option: z.string().optional(),
  key: z.string().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().optional(),
}).strict();

export const StructuredActionSchema = z.object({
  action_id: z.string(),
  request_id: z.string(),
  action: ActionTypeSchema,
  target: z.object({ region_id: z.string() }).strict().nullable(),
  params: ActionParamsSchema.nullable(),
  capability: z.string().nullable(),
  origin: z.string(),
  frame_id: FrameIdSchema,
  page_state_hash: z.string(),
  rationale: z.string().optional(),
}).strict();

export const PlanResponseSchema = z.object({
  request_id: z.string(),
  status: z.enum(['action', 'done', 'need_user', 'fail']),
  action: StructuredActionSchema.nullable(),
  message: z.string().nullable(),
  usage: z.object({
    server_ms: z.number(),
    model: z.string(),
  }).strict(),
}).strict();

export const SanitizedRegionSchema = z.object({
  region_id: z.string(),
  type: SemanticTypeSchema,
  text: z.string().nullable(),
  bbox: BBoxSchema,
  state: z.array(VisualStateSchema),
  interactable: z.boolean(),
  frame_id: FrameIdSchema,
  sources: z.array(SourceSchema),
  confidence: z.number(),
  relations: z.array(z.object({ rel: z.string(), target: z.string() }).strict()).optional(),
  trust: z.literal('untrusted'),
}).strict();

export const SanitizedContextSchema = z.object({
  schema_version: z.literal('1.0'),
  request_id: z.string(),
  task_id: z.string(),
  step_index: z.number(),
  task: z.string(),
  page: z.object({
    origin: z.string(),
    path: z.string(),
    title: z.string().nullable(),
    page_state_hash: z.string(),
    viewport: z.object({ w: z.number(), h: z.number() }).strict(),
    frame_ids: z.array(FrameIdSchema),
  }).strict(),
  regions: z.array(SanitizedRegionSchema),
  capabilities: z.array(CapabilityDescriptorSchema),
  redactions: z.array(z.object({
    type: PiiTypeSchema,
    count: z.number(),
  }).strict()),
  image: z.object({
    mime: z.literal('image/jpeg'),
    data_base64: z.string(),
    width: z.number(),
    height: z.number(),
    covers_region_ids: z.array(z.string()),
  }).strict().nullable(),
  history: z.array(StepSummarySchema),
  flags: z.object({
    injection_suspected_region_ids: z.array(z.string()),
  }).strict(),
}).strict();

export const AttestedPayloadSchema = z.object({
  request_id: z.string(),
  body: z.string(),
  sha256: z.string().length(64),
  issued_at: z.number(),
}).strict();
