import re

file_path = "extension/src/background/assemble-frame.ts"
with open(file_path, "r") as f:
    content = f.read()

iou_function = """
function getIntersectionArea(b1: [number, number, number, number], b2: [number, number, number, number]): number {
  const xLeft = Math.max(b1[0], b2[0]);
  const yTop = Math.max(b1[1], b2[1]);
  const xRight = Math.min(b1[0] + b1[2], b2[0] + b2[2]);
  const yBottom = Math.min(b1[1] + b1[3], b2[1] + b2[3]);
  if (xRight < xLeft || yBottom < yTop) return 0;
  return (xRight - xLeft) * (yBottom - yTop);
}
"""

if "getIntersectionArea" not in content:
    content = content.replace("export interface AssemblyResult", iou_function + "\nexport interface AssemblyResult")

old_vision_push = """  // 2. Fused Medium/Low regions from VisionResult
  if (visionResult && visionResult.regions) {
    for (const vReg of visionResult.regions) {
      candidateRegions.push(vReg);
    }
  }"""

new_vision_push = """  // 2. Fused Medium/Low regions from VisionResult (IoU Spatial Fusion)
  if (visionResult && visionResult.regions) {
    for (const vReg of visionResult.regions) {
      let isDuplicate = false;
      
      // Phase 3 IoU Fusion: Does this OCR/Vision region overlap highly with an existing DOM region?
      for (const dReg of candidateRegions) {
        if (!dReg.bbox || !vReg.bbox) continue;
        const intersection = getIntersectionArea(dReg.bbox, vReg.bbox);
        const vArea = vReg.bbox[2] * vReg.bbox[3];
        
        // If the vision region is > 80% inside a DOM region
        if (vArea > 0 && intersection / vArea > 0.8) {
          isDuplicate = true;
          // Merge text if DOM region lacked it
          if (!dReg.text && vReg.text) {
            dReg.text = vReg.text;
          }
          // Mark the DOM region as having an OCR source match to trigger Canvas Blackout!
          if (vReg.source?.includes('OCR')) {
            dReg.source = dReg.source || [];
            if (!dReg.source.includes('OCR')) dReg.source.push('OCR');
          }
          break;
        }
      }
      
      // Only push if it is a truly novel visual element (e.g. drawn on a canvas)
      if (!isDuplicate) {
        candidateRegions.push(vReg);
      }
    }
  }"""

content = content.replace(old_vision_push, new_vision_push)

with open(file_path, "w") as f:
    f.write(content)
