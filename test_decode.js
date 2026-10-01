// Quick test to see if I can write the SSD decoding
const variance = [0.1, 0.2];
// prior = [(c + 0.5) * stride / w, (r + 0.5) * stride / h, stride / w, stride / h]
// cx = (prior[0] + loc[0] * variance[0] * prior[2]) * w
// cy = (prior[1] + loc[1] * variance[0] * prior[3]) * h
// w = exp(loc[2] * variance[1]) * prior[2] * w
// h = exp(loc[3] * variance[1]) * prior[3] * h
