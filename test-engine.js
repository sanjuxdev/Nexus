import fs from 'fs';
const elements = [
  { tag: 'img', dom_id: 'user-avatar', bbox: [10, 10, 100, 100], visible: true },
  { tag: 'canvas', id: 'canvas-login', bbox: [320, 500, 160, 42], visible: true }
];
const faces = [];
elements.filter(e => 
  e.visible &&
  (e.tag === 'img' || e.role === 'img') &&
  e.tag !== 'canvas' &&
  e.tag !== 'button' &&
  e.rendering !== 'canvas' &&
  (e.dom_id === 'user-avatar' ||
    e.id === 'user-avatar' ||
    e.name?.toLowerCase().includes('avatar') ||
    e.name?.toLowerCase().includes('face') ||
    e.name?.toLowerCase().includes('profile') ||
    (e.bbox[2] <= 120 && e.bbox[3] <= 120))
).forEach(e => faces.push(e));
console.log(faces);
