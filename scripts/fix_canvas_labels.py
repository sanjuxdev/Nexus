import re

file_path = "extension/src/privacy.stub.ts"
with open(file_path, "r") as f:
    content = f.read()

# 1. Update the boxesToRedact type definition in redactImageCanvas signature
content = content.replace(
    "boxesToRedact: { x: number; y: number; w: number; h: number; label: string }[],",
    "boxesToRedact: { x: number; y: number; w: number; h: number; label: string; source?: string }[],"
)

# 2. Update the fillText in redactImageCanvas
old_fillText = """      ctx.fillText(
        `[REDACTED: ${box.label}]`,"""
new_fillText = """      const sourceText = box.source ? `[${box.source} REDACTED]` : `[REDACTED]`;
      ctx.fillText(
        `${sourceText} ${box.label}`,"""
content = content.replace(old_fillText, new_fillText)

# 3. Update the boxesToMask declaration type
content = content.replace(
    "const boxesToMask: { x: number; y: number; w: number; h: number; label: string }[] = [];",
    "const boxesToMask: { x: number; y: number; w: number; h: number; label: string; source?: string }[] = [];"
)

# 4. Update the push to boxesToMask in the regular parsing loop (lines ~350)
old_push_1 = """      if (regionHasPii && reg.bbox) {
        boxesToMask.push({
          x: reg.bbox[0],
          y: reg.bbox[1],
          w: reg.bbox[2],
          h: reg.bbox[3],
          label: boxLabel,
        });"""
new_push_1 = """      if (regionHasPii && reg.bbox) {
        const isOCR = reg.sources?.includes('OCR') || reg.source?.includes('OCR');
        boxesToMask.push({
          x: reg.bbox[0],
          y: reg.bbox[1],
          w: reg.bbox[2],
          h: reg.bbox[3],
          label: boxLabel,
          source: isOCR ? 'OCR' : 'DOM',
        });"""
content = content.replace(old_push_1, new_push_1)

# 5. Update the face push
old_face_push = """        boxesToMask.push({
          x: face.bbox[0],
          y: face.bbox[1],
          w: face.bbox[2],
          h: face.bbox[3],
          label: 'FACE',
        });"""
new_face_push = """        boxesToMask.push({
          x: face.bbox[0],
          y: face.bbox[1],
          w: face.bbox[2],
          h: face.bbox[3],
          label: 'FACE',
          source: 'OCR',
        });"""
content = content.replace(old_face_push, new_face_push)

with open(file_path, "w") as f:
    f.write(content)
