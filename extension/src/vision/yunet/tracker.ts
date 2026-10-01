import type { FaceBox } from '@contracts/index.js';
import { computeIoU } from './yunet-postprocess.js';

export interface TrackedFace {
  id: string;
  bbox: [number, number, number, number];
  confidence: number;
  missedFrames: number;
  age: number;
}

export class FaceTracker {
  private tracks: TrackedFace[] = [];
  private nextId = 1;
  private readonly MAX_MISSED = 0; // Disable keeping missed frames alive to prevent masks sticking during scroll
  private readonly IOU_THRESHOLD = 0.3; // Minimum overlap to consider it the same face
  private readonly SMOOTHING = 0.0; // Disable smoothing to prevent mask lag when scrolling

  public update(detections: FaceBox[]): FaceBox[] {
    const newTracks: TrackedFace[] = [];
    const unmatchedDetections = [...detections];
    const unmatchedTracks = [...this.tracks];

    // 1. Match existing tracks to new detections (greedy highest IoU)
    for (let t = 0; t < unmatchedTracks.length; t++) {
      const track = unmatchedTracks[t]!;
      let bestIoU = 0;
      let bestDetIdx = -1;

      for (let d = 0; d < unmatchedDetections.length; d++) {
        const det = unmatchedDetections[d]!;
        const iou = computeIoU(track.bbox, det.bbox);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestDetIdx = d;
        }
      }

      if (bestIoU >= this.IOU_THRESHOLD) {
        const det = unmatchedDetections[bestDetIdx]!;
        // Smooth the bounding box to prevent jitter
        const s = this.SMOOTHING;
        const newBbox: [number, number, number, number] = [
          track.bbox[0] * s + det.bbox[0] * (1 - s),
          track.bbox[1] * s + det.bbox[1] * (1 - s),
          track.bbox[2] * s + det.bbox[2] * (1 - s),
          track.bbox[3] * s + det.bbox[3] * (1 - s),
        ];

        newTracks.push({
          id: track.id,
          bbox: newBbox,
          confidence: det.confidence,
          missedFrames: 0,
          age: track.age + 1,
        });

        // Remove the matched detection so it isn't used again
        unmatchedDetections.splice(bestDetIdx, 1);
        unmatchedTracks.splice(t, 1);
        t--; // Adjust index after splice
      }
    }

    // 2. Any tracks that didn't match get their missedFrames incremented
    for (const track of unmatchedTracks) {
      if (track.missedFrames < this.MAX_MISSED) {
        newTracks.push({
          ...track,
          missedFrames: track.missedFrames + 1,
          age: track.age + 1,
        });
      }
    }

    // 3. Any remaining detections become new tracks
    for (const det of unmatchedDetections) {
      newTracks.push({
        id: `track_${this.nextId++}`,
        bbox: det.bbox,
        confidence: det.confidence,
        missedFrames: 0,
        age: 1,
      });
    }

    this.tracks = newTracks;

    // Convert internal tracks back to FaceBox output format
    return this.tracks.map(t => ({
      bbox: [
        Math.round(t.bbox[0]),
        Math.round(t.bbox[1]),
        Math.round(t.bbox[2]),
        Math.round(t.bbox[3]),
      ],
      confidence: t.confidence,
      coordinateSpace: 'frame',
      face_id: t.id
    }) as any);
  }
}
