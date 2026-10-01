import os

file_path = "extension/src/background/orchestrator.ts"
with open(file_path, "r") as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    if "let captureMeta: CaptureMeta | null = null;" in line:
        new_lines.append(line)
        new_lines.append("      let latestDataUrl: string | undefined = undefined;\n")
    elif "const { dataUrl, meta } = await captureScreenshot(" in line:
        new_lines.append("        const { dataUrl, meta } = await captureScreenshot(\n")
        new_lines.append("          session.tab_id,\n")
        new_lines.append("          domSnapshot.page_state_hash\n")
        new_lines.append("        );\n")
        new_lines.append("        latestDataUrl = dataUrl;\n")
        # We need to skip the next 4 lines since we just wrote them
    elif "session.tab_id," in line and "domSnapshot.page_state_hash" in lines[i+1]:
        # Skipping
        pass
    elif "domSnapshot.page_state_hash" in line and "session.tab_id," in lines[i-1]:
        pass
    elif ");" in line and "domSnapshot.page_state_hash" in lines[i-1]:
        pass
    elif "image_data_url: (typeof dataUrl" in line:
        new_lines.append("        image_data_url: latestDataUrl,\n")
    else:
        new_lines.append(line)

with open(file_path, "w") as f:
    f.writelines(new_lines)
