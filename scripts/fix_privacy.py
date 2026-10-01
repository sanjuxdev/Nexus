import re

file_path = "extension/src/privacy.stub.ts"
with open(file_path, "r") as f:
    content = f.read()

# Replace Regexes
content = content.replace("const panRegex = /\\b[A-Z]{3}[PCHFATBLJG][A-Z]\\d{4}[A-Z]\\b/g;", "const panRegex = /\\b[a-zA-Z]{5}\\d{4}[a-zA-Z]\\b/g;")
content = content.replace("const phoneRegex = /(?:(?:\\+\\d{1,3}|0)[\\s-]?)?(?:[5-9]\\d{9}|\\d{10,13}|\\d{3,5}[\\s-]\\d{3,5}[\\s-]?\\d{0,4})\\b/g;", "const phoneRegex = /(?:(?:\\+\\d{1,3}|0)[\\s-]?)?(?:[5-9]\\d{9})\\b/g;")

# Add Semantic Field Logic
old_password_logic = """
      // Whole-region mask for password fields (Member 3 spec / Invariant I5)
      const isPassword =
        reg.semantic_type === 'input' &&
        (reg.text?.toLowerCase().includes('password') ||
          (reg.local_key
            ? req.frame.dom?.elements?.find((e) => e.dom_id === reg.local_key)?.input?.is_password
            : false));
      if (isPassword && !regionHasPii) {
        regionHasPii = true;
        boxLabel = 'PASSWORD';
        detections.push({
          id: `pii_password_${reg.region_id}`,
          type: 'PASSWORD',
          source: ['DOM', 'VAULT'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
      }"""

new_semantic_logic = """
      // Semantic Field Redaction for forms
      const regKey = reg.local_key?.toLowerCase() || '';
      const regText = reg.text?.toLowerCase() || '';
      
      const isPassword = reg.semantic_type === 'input' && (regText.includes('password') || (reg.local_key ? req.frame.dom?.elements?.find((e: any) => e.dom_id === reg.local_key)?.input?.is_password : false));
      const isPhoneField = reg.semantic_type === 'input' && (regText.includes('phone') || regText.includes('mobile') || regKey.includes('phone') || regKey.includes('mobile'));
      const isAadhaarField = reg.semantic_type === 'input' && (regText.includes('aadhaar') || regText.includes('aadhar') || regKey.includes('aadhaar'));
      const isPanField = reg.semantic_type === 'input' && (regText.includes('pan number') || regKey.includes('pan'));

      if (!regionHasPii && (isPassword || isPhoneField || isAadhaarField || isPanField)) {
        regionHasPii = true;
        boxLabel = isPassword ? 'PASSWORD' : isPhoneField ? 'PHONE' : isAadhaarField ? 'AADHAAR' : 'PAN';
        const piiType = isPassword ? 'PASSWORD' : isPhoneField ? 'PHONE' : 'GOV_ID';
        
        detections.push({
          id: `pii_${boxLabel.toLowerCase()}_${reg.region_id}`,
          type: piiType as any,
          source: ['DOM', 'VAULT'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = `<REDACTED_${boxLabel}>`;
      }"""

content = content.replace(old_password_logic, new_semantic_logic)

# Replace source hardcoding to dynamically use OCR if available
old_regex_push_aadhaar = """
              detections.push({
                id: `pii_aadhaar_${reg.region_id}`,
                type: 'GOV_ID',
                source: ['REGEX'],"""

new_regex_push_aadhaar = """
              const isOCR = reg.sources?.includes('OCR') || reg.source?.includes('OCR');
              detections.push({
                id: `pii_aadhaar_${reg.region_id}`,
                type: 'GOV_ID',
                source: isOCR ? ['OCR'] : ['REGEX'],"""
content = content.replace(old_regex_push_aadhaar, new_regex_push_aadhaar)

old_regex_push_pan = """
              detections.push({
                id: `pii_pan_${reg.region_id}`,
                type: 'GOV_ID',
                source: ['REGEX'],"""
new_regex_push_pan = """
              const isOCR = reg.sources?.includes('OCR') || reg.source?.includes('OCR');
              detections.push({
                id: `pii_pan_${reg.region_id}`,
                type: 'GOV_ID',
                source: isOCR ? ['OCR'] : ['REGEX'],"""
content = content.replace(old_regex_push_pan, new_regex_push_pan)

with open(file_path, "w") as f:
    f.write(content)

