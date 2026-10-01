import { FilesetResolver } from '@mediapipe/tasks-vision';
async function test() {
  const vision = await FilesetResolver.forVisionTasks('chrome-extension://foo/mediapipe/');
  console.log(vision);
}
test();
