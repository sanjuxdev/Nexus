const fs = require('fs');
const https = require('https');

async function fetchBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve('data:' + res.headers['content-type'] + ';base64,' + Buffer.concat(chunks).toString('base64')));
    });
  });
}

(async () => {
  const img1 = await fetchBase64('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/George_Washington_by_Gilbert_Stuart.jpg/400px-George_Washington_by_Gilbert_Stuart.jpg');
  const img2 = await fetchBase64('https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/1927_Solvay_Conference_on_Quantum_Mechanics_-_restored_1.jpg/800px-1927_Solvay_Conference_on_Quantum_Mechanics_-_restored_1.jpg');
  const img3 = await fetchBase64('https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Abraham_Lincoln_O-116_by_Gardner%2C_1865-crop.png/400px-Abraham_Lincoln_O-116_by_Gardner%2C_1865-crop.png');
  const img4 = await fetchBase64('https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons.jpg/400px-Tour_Eiffel_Wikimedia_Commons.jpg');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Face Detection Test Suite</title>
  <style>
    body { font-family: sans-serif; background: #eee; padding: 20px; }
    .card { background: white; padding: 10px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: inline-block; }
    .card img { max-width: 400px; display: block; margin-bottom: 10px; }
  </style>
</head>
<body>
  <h1>YuNet Face Detection Testing</h1>

  <div class="card" id="large-face">
    <h2>1. Large Face</h2>
    <img src="${img1}" alt="Large Face">
    <p>This is a portrait card.</p>
  </div>

  <div class="card" id="multiple-small">
    <h2>2. Small & Multiple Faces</h2>
    <img src="${img2}" alt="Group Photo" style="max-width: 800px;">
    <p>Solvay Conference</p>
  </div>

  <div class="card" id="profile-occluded">
    <h2>3. Profile & Occluded</h2>
    <img src="${img3}" alt="Profile">
  </div>
  
  <div class="card" id="no-face">
    <h2>4. No Faces</h2>
    <img src="${img4}" alt="Eiffel Tower">
  </div>

  <script>
    // Relay logs from background if possible, or we just rely on visual checks.
  </script>
</body>
</html>`;
  fs.writeFileSync('test_faces_b64.html', html);
})();
